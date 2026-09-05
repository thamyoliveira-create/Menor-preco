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
      productCatIds
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

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });
  const appId = process.env.SHOPEE_APP_ID;
  const secret = process.env.SHOPEE_APP_SECRET;
  const endpoint = process.env.SHOPEE_API_URL || 'https://open-api.affiliate.shopee.com.br/graphql';
  if (!appId || !secret) {
    return res.status(503).json({ error: 'A busca ainda precisa das credenciais da Shopee nas configurações protegidas da Vercel.' });
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
    const offers = nodes.map((item) => {
      const price = number(item.priceMin || item.priceMax);
      const discountPercent = normalizePercent(item.priceDiscountRate);
      const previousPrice = discountPercent > 0 && discountPercent < 100 ? price / (1 - discountPercent / 100) : 0;
      return {
        itemId: String(item.itemId),
        name: item.productName,
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
        relevanceScore: relevance(item),
      };
    }).sort((a, b) => b.relevanceScore - a.relevanceScore);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ offers });
  } catch {
    return res.status(502).json({ error: 'A Shopee não respondeu. Tente novamente em alguns instantes.' });
  }
};
