const PRICES = {
  parking: {
    basic: 19,
    pro: 29,
    premium: 49
  },

  debt: {
    basic: 29,
    pro: 49,
    premium: 79
  },

  bill: {
    basic: 29,
    pro: 49,
    premium: 79
  },

  subscription: {
    basic: 29,
    pro: 39,
    premium: 69
  }
};

const CURRENCY = "£";

function formatPrice(value) {
  return `${CURRENCY}${value}`;
}

function applyPricing(type) {
  const prices = PRICES[type];

  if (!prices) {
    console.warn("Unknown pricing type:", type);
    return;
  }

  const basicEl = document.getElementById("price-basic");
  const proEl = document.getElementById("price-pro");
  const premiumEl = document.getElementById("price-premium");

  if (basicEl) {
    basicEl.textContent = formatPrice(prices.basic);
  }

  if (proEl) {
    proEl.textContent = formatPrice(prices.pro);
  }

  if (premiumEl) {
    premiumEl.textContent = formatPrice(prices.premium);
  }
}

const params = new URLSearchParams(window.location.search);
const type = params.get("type") || "debt";

applyPricing(type);
