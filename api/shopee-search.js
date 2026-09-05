const crypto = require('node:crypto');

function searchQuery(shopId = '') {
  const shopFilter = /^\d+$/.test(String(shopId)) ? `shopId: ${shopId},` : '';
  return `query SearchOffers($keyword: String, $sortType: Int, $page: Int, $limit: Int) {
  productOfferV2(keyword: $keyword, ${shopFilter} sortType: $sortType, page: $page, limit: $limit) {
    nodes {
      itemId
      productName
      productLink
      offerLink
      imageUrl
      priceMin
      priceMax
      priceDiscountRate
      sales
      ratingStar
      commissionRate
      shopName
      shopType
      productCatIds
    }
  }
  campaigns: shopeeOfferV2(sortType: 1, page: 1, limit: 30) {
    nodes {
      commissionRate
      imageUrl
      offerLink
      originalLink
      offerName
      offerType
      periodStartTime
      periodEndTime
    }
  }
}`;
}

const SHOP_QUERY = `query FindShop($keyword: String) {
  shopOfferV2(keyword: $keyword, sortType: 1, page: 1, limit: 10) {
    nodes { shopId shopName shopType ratingStar offerLink }
  }
}`;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePercent(value) {
  const parsed = number(value);
  return parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
}

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function keywordMatch(name, keyword) {
  const ignored = new Set(['barato', 'barata', 'oferta', 'ofertas', 'relampago', 'promocao', 'desconto', 'melhor', 'preco']);
  const tokens = normalizeText(keyword).split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !ignored.has(token));
  if (!tokens.length) return 1;
  const normalizedName = normalizeText(name);
  return tokens.filter((token) => normalizedName.includes(token)).length / tokens.length;
}

function quality(item, keyword, storeSearch = false, flashSearch = false) {
  const rating = number(item.ratingStar);
  const sales = number(item.sales);
  const badge = shopBadge(item.shopType).code;
  const match = storeSearch ? 1 : keywordMatch(item.productName, keyword);
  const discount = normalizePercent(item.priceDiscountRate);
  const valid = number(item.priceMin || item.priceMax) > 0 && item.productName && item.productLink && match >= 0.5 && (!flashSearch || discount >= 10);
  const trusted = badge === 'official'
    ? rating >= 4.3 && sales >= 5
    : badge === 'preferred' || badge === 'preferred_plus'
      ? rating >= 4.5 && sales >= 20
      : rating >= 4.7 && sales >= 100;
  const badgePoints = badge === 'official' ? 15 : badge === 'preferred_plus' ? 12 : badge === 'preferred' ? 9 : 0;
  const score = match * 40 + Math.max(0, rating - 4) * 25 + Math.min(Math.log10(sales + 1) * 7, 20) + badgePoints;
  return { eligible: Boolean(valid && trusted), match, score: Math.max(0, Math.min(100, Math.round(score))) };
}

function shopBadge(shopType) {
  const types = Array.isArray(shopType) ? shopType.map(Number) : [Number(shopType)];
  if (types.includes(1)) return { code: 'official', label: 'Loja Oficial' };
  if (types.includes(4)) return { code: 'preferred_plus', label: 'Loja Indicada+' };
  if (types.includes(2)) return { code: 'preferred', label: 'Loja Indicada' };
  return { code: 'regular', label: 'Loja comum' };
}

function campaignName(value) {
  return String(value || 'Campanha Shopee')
    .replace(/^KOL_KOC_LT\s*-\s*BAU\s*-\s*/i, '')
    .replace(/^BAU\s*-\s*/i, '')
    .trim() || 'Campanha Shopee';
}

function inferCategory(keyword) {
  const value = keyword.toLocaleLowerCase('pt-BR');
  if (/maquiagem|beleza|skincare|perfume|cosm[eé]tico|cabelo/.test(value)) return 'beleza';
  if (/infantil|crian[cç]a|beb[eê]|brinquedo/.test(value)) return 'infantil';
  if (/roupa|moda|vestido|blusa|cal[cç]a|conjunto|sapato/.test(value)) return 'moda';
  if (/casa|cozinha|organiza[cç][aã]o|decora[cç][aã]o/.test(value)) return 'casa';
  if (/eletr[oô]nico|celular|fone|computador|gamer/.test(value)) return 'eletronicos';
  return 'outros';
}

function shopIdFromLink(productLink) {
  const match = String(productLink || '').match(/\/product\/(\d+)\/\d+/);
  return match?.[1] || '';
}

async function shopOrigin(productLink) {
  const shopId = shopIdFromLink(productLink);
  if (!shopId) return { code: 'unknown', label: 'Origem não informada' };

  try {
    const response = await fetch(`https://shopee.com.br/api/v4/shop/get_shop_detail?shopid=${shopId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(3000),
    });
    const data = await response.json();
    const shop = data?.data;
    if (!response.ok || !shop) throw new Error('Loja não encontrada');
    if (Number(shop.cb_option) > 0) return { code: 'international', label: 'Internacional' };
    if (shop.country === 'BR') return { code: 'national', label: 'Nacional' };
    return shop.country
      ? { code: 'international', label: 'Internacional' }
      : { code: 'unknown', label: 'Origem não informada' };
  } catch {
    return { code: 'unknown', label: 'Origem não informada' };
  }
}

async function callShopee(endpoint, appId, secret, query, variables) {
  const payload = JSON.stringify({ query, variables });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash('sha256').update(`${appId}${timestamp}${payload}${secret}`, 'utf8').digest('hex');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `SHA256 Credential=${appId},Timestamp=${timestamp},Signature=${signature}`,
    },
    body: payload,
  });
  const data = await response.json();
  if (!response.ok || data.errors?.length) throw new Error(data.errors?.[0]?.message || `Erro ${response.status} ao consultar a Shopee.`);
  return data.data || {};
}

async function resolveShop(store, endpoint, appId, secret) {
  const productShopId = shopIdFromLink(store);
  if (productShopId) return { id: productShopId, name: '' };

  if (/^https?:\/\//i.test(store)) {
    const url = new URL(store);
    const username = url.pathname.split('/').filter(Boolean)[0];
    if (username) {
      const response = await fetch(`https://shopee.com.br/api/v4/shop/get_shop_detail?username=${encodeURIComponent(username)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000),
      });
      const shop = (await response.json())?.data;
      if (shop?.shopid) return { id: String(shop.shopid), name: shop.name || username };
    }
  }

  const data = await callShopee(endpoint, appId, secret, SHOP_QUERY, { keyword: store });
  const shops = data.shopOfferV2?.nodes || [];
  const normalized = store.toLocaleLowerCase('pt-BR');
  const shop = shops.find((item) => String(item.shopName || '').toLocaleLowerCase('pt-BR') === normalized) || shops[0];
  return shop?.shopId ? { id: String(shop.shopId), name: shop.shopName || store } : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });
  const appId = process.env.SHOPEE_APP_ID;
  const secret = process.env.SHOPEE_APP_SECRET;
  const endpoint = process.env.SHOPEE_API_URL || 'https://open-api.affiliate.shopee.com.br/graphql';
  if (!appId || !secret) {
    const missing = [!appId && 'SHOPEE_APP_ID', !secret && 'SHOPEE_APP_SECRET'].filter(Boolean);
    return res.status(503).json({ error: `Variável ausente na Vercel: ${missing.join(' e ')}. Salve em Production e faça um novo deployment.` });
  }

  const keyword = String(req.query.keyword || '').trim().slice(0, 100);
  const store = String(req.query.store || '').trim().slice(0, 200);
  const allowedSorts = new Set([1, 2, 4, 5]);
  const sortType = allowedSorts.has(Number(req.query.sortType)) ? Number(req.query.sortType) : 1;
  if (keyword.length < 2 && store.length < 2) return res.status(400).json({ error: 'Informe um produto ou uma loja.' });
  const flashSearch = /oferta(?:s)?\s+rel[aâ]mpago|rel[aâ]mpago/i.test(keyword);
  const productKeyword = flashSearch ? '' : keyword;

  try {
    const resolvedStore = store ? await resolveShop(store, endpoint, appId, secret) : null;
    if (store && !resolvedStore) return res.status(404).json({ error: 'Não encontrei essa loja. Confira o nome ou cole o link completo da loja.' });
    const data = await callShopee(endpoint, appId, secret, searchQuery(resolvedStore?.id), { keyword: productKeyword || null, sortType, page: 1, limit: 30 });
    const nodes = data.productOfferV2?.nodes || [];
    const mappedOffers = await Promise.all(nodes.map(async (item) => {
      const price = number(item.priceMin || item.priceMax);
      const discountPercent = normalizePercent(item.priceDiscountRate);
      const previousPrice = discountPercent > 0 && discountPercent < 100 ? price / (1 - discountPercent / 100) : 0;
      const origin = await shopOrigin(item.productLink);
      const productQuality = quality(item, productKeyword, Boolean(store), flashSearch);
      return {
        itemId: String(item.itemId),
        name: item.productName,
        category: inferCategory(productKeyword || store),
        productLink: item.productLink,
        offerLink: item.offerLink,
        imageUrl: item.imageUrl,
        price,
        previousPrice: Math.round(previousPrice * 100) / 100,
        discountPercent,
        sales: number(item.sales),
        rating: number(item.ratingStar),
        commissionRate: normalizePercent(item.commissionRate),
        shopName: item.shopName,
        shopBadge: shopBadge(item.shopType),
        shopOrigin: origin,
        relevanceScore: productQuality.score,
        keywordMatch: productQuality.match,
        eligible: productQuality.eligible,
      };
    }));
    const offers = mappedOffers.filter((item) => item.eligible);
    offers.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const now = Math.floor(Date.now() / 1000);
    const campaigns = (data.campaigns?.nodes || [])
      .filter((campaign) => {
        const end = number(campaign.periodEndTime);
        const start = number(campaign.periodStartTime);
        return (!start || start <= now) && (!end || end >= now);
      })
      .slice(0, 8)
      .map((campaign, index) => ({
        id: `${campaign.offerType || 0}-${campaign.periodEndTime || 0}-${index}`,
        name: campaignName(campaign.offerName),
        imageUrl: campaign.imageUrl || '',
        link: campaign.offerLink || campaign.originalLink || '',
        commissionRate: normalizePercent(campaign.commissionRate),
        startsAt: number(campaign.periodStartTime),
        endsAt: number(campaign.periodEndTime) > now + (86400 * 730) ? 0 : number(campaign.periodEndTime),
      }));
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ offers, campaigns, store: resolvedStore, filteredCount: mappedOffers.length - offers.length, searchMode: flashSearch ? 'flash' : 'products' });
  } catch (error) {
    return res.status(502).json({ error: error.message || 'A Shopee não respondeu. Tente novamente em alguns instantes.' });
  }
};
