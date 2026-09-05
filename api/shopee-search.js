const crypto = require('node:crypto');

const QUERY = `query SearchOffers($keyword: String, $sortType: Int, $page: Int, $limit: Int) {
  productOfferV2(keyword: $keyword, sortType: $sortType, page: $page, limit: $limit) {
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

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePercent(value) {
  const parsed = number(value);
  return parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
}

function relevance(item) {
  const discount = Math.min(normalizePercent(item.priceDiscountRate), 60);
  const rating = number(item.ratingStar);
  const sales = number(item.sales);
  const commission = normalizePercent(item.commissionRate);
  const score = discount * 0.55 + Math.max(0, rating - 3) * 18 + Math.min(Math.log10(sales + 1) * 7, 18) + Math.min(commission * 0.25, 5);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function shopBadge(shopType) {
  const types = Array.isArray(shopType) ? shopType.map(Number) : [Number(shopType)];
  if (types.includes(1)) return { code: 'official', label: 'Loja Oficial' };
  if (types.includes(4)) return { code: 'preferred_plus', label: 'Loja Indicada+' };
  if (types.includes(2)) return { code: 'preferred', label: 'Loja Indicada' };
  return { code: 'regular', label: 'Loja comum' };
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
  const allowedSorts = new Set([1, 2, 4, 5]);
  const sortType = allowedSorts.has(Number(req.query.sortType)) ? Number(req.query.sortType) : 1;
  if (keyword.length < 2) return res.status(400).json({ error: 'Informe um termo de busca.' });

  const payload = JSON.stringify({ query: QUERY, variables: { keyword, sortType, page: 1, limit: 30 } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash('sha256').update(`${appId}${timestamp}${payload}${secret}`, 'utf8').digest('hex');

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `SHA256 Credential=${appId},Timestamp=${timestamp},Signature=${signature}`,
      },
      body: payload,
    });
    const data = await response.json();
    if (!response.ok || data.errors?.length) {
      const message = data.errors?.[0]?.message || `Erro ${response.status} ao consultar a Shopee.`;
      return res.status(502).json({ error: message });
    }
    const nodes = data.data?.productOfferV2?.nodes || [];
    const offers = await Promise.all(nodes.map(async (item) => {
      const price = number(item.priceMin || item.priceMax);
      const discountPercent = normalizePercent(item.priceDiscountRate);
      const previousPrice = discountPercent > 0 && discountPercent < 100 ? price / (1 - discountPercent / 100) : 0;
      const origin = await shopOrigin(item.productLink);
      return {
        itemId: String(item.itemId),
        name: item.productName,
        category: inferCategory(keyword),
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
        relevanceScore: relevance(item),
      };
    }));
    offers.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const now = Math.floor(Date.now() / 1000);
    const campaigns = (data.data?.campaigns?.nodes || [])
      .filter((campaign) => {
        const end = number(campaign.periodEndTime);
        return (!end || end >= now) && /cupom|desconto|\boff\b|frete|loja oficial/i.test(campaign.offerName || '');
      })
      .slice(0, 8)
      .map((campaign, index) => ({
        id: `${campaign.offerType || 0}-${campaign.periodEndTime || 0}-${index}`,
        name: campaign.offerName || 'Campanha Shopee',
        imageUrl: campaign.imageUrl || '',
        link: campaign.offerLink || campaign.originalLink || '',
        commissionRate: normalizePercent(campaign.commissionRate),
        startsAt: number(campaign.periodStartTime),
        endsAt: number(campaign.periodEndTime),
      }));
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ offers, campaigns });
  } catch {
    return res.status(502).json({ error: 'A Shopee não respondeu. Tente novamente em alguns instantes.' });
  }
};
