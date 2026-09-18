(() => {
  "use strict";
  const CARD_ID = "kb-total-cost-card";
  const TOTAL_RE = /total\s*(?:cost|price)\s*:?/i;
  const MONEY_RE = /(?:US\s*\$|USD|€|EUR|CN\s*¥|CNY|RMB|¥|￥|£|GBP|KM|BAM)\s*([\d.,]+)|([\d.,]+)\s*(?:US\s*\$|USD|€|EUR|CNY|RMB|元|£|GBP|KM|BAM)/i;
  const rateCache = new Map();
  let scheduled = false;

  function parseMoney(text) {
    const match = String(text || "").replace(/\u00a0/g, " ").match(MONEY_RE);
    if (!match) return null;
    const value = Number((match[1] || match[2]).replace(/,/g, ""));
    if (!Number.isFinite(value)) return null;
    const token = match[0].replace(/[\d.,\s]/g, "").toUpperCase();
    let currency = "";
    if (token.includes("€") || token.includes("EUR")) currency = "EUR";
    else if (token.includes("$") || token.includes("USD")) currency = "USD";
    else if (token.includes("£") || token.includes("GBP")) currency = "GBP";
    else if (token.includes("KM") || token.includes("BAM")) currency = "BAM";
    else if (/¥|￥|CNY|RMB|元/.test(token)) currency = "CNY";
    return currency ? { value, currency } : null;
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement) || element.id === CARD_ID || element.closest(`#${CARD_ID}`)) return false;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
  }

  function findTotals() {
    const candidates = [];
    for (const element of document.querySelectorAll("body *")) {
      if (!isVisible(element) || element.children.length > 10) continue;
      const text = (element.textContent || "").replace(/\s+/g, " ").trim();
      const labelIndex = text.search(TOTAL_RE);
      if (labelIndex < 0 || text.length > 240) continue;
      const afterLabel = text.slice(labelIndex).replace(TOTAL_RE, "").trim();
      const money = parseMoney(afterLabel);
      if (money) candidates.push({ element, ...money });
    }

    const leaves = candidates.filter(candidate =>
      !candidates.some(other => other !== candidate && candidate.element.contains(other.element))
    );
    const unique = [];
    for (const candidate of leaves) {
      const box = candidate.element.getBoundingClientRect();
      const duplicate = unique.some(item =>
        item.currency === candidate.currency && item.value === candidate.value &&
        Math.abs(item.y - box.top) < 3 && Math.abs(item.x - box.left) < 3
      );
      if (!duplicate) unique.push({ ...candidate, x: box.left, y: box.top });
    }
    return unique;
  }

  function formatAmount(value, currency) {
    return new Intl.NumberFormat("bs-BA", {
      style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format(value);
  }

  async function rateToBam(currency) {
    if (currency === "BAM") return 1;
    if (currency === "EUR") return 1.95583;
    if (rateCache.has(currency)) return rateCache.get(currency);
    const response = await fetch(`https://api.frankfurter.app/latest?from=${currency}&to=EUR`);
    if (!response.ok) throw new Error("Kurs nije dostupan");
    const data = await response.json();
    const rate = Number(data?.rates?.EUR) * 1.95583;
    if (!Number.isFinite(rate)) throw new Error("Neispravan kurs");
    rateCache.set(currency, rate);
    return rate;
  }

  function getCard() {
    let card = document.getElementById(CARD_ID);
    if (card) return card;
    card = document.createElement("aside");
    card.id = CARD_ID;
    card.setAttribute("aria-live", "polite");
    card.innerHTML = '<div class="kb-title"><span class="kb-dot"></span>Total cost</div><div class="kb-amount">—</div><div class="kb-note">—</div>';
    document.documentElement.appendChild(card);
    return card;
  }

  async function update() {
    scheduled = false;
    const card = getCard();
    const totals = findTotals();
    if (!totals.length) {
      card.style.display = "none";
      return;
    }
    const currency = totals[0].currency;
    const totalValue = totals.filter(item => item.currency === currency).reduce((sum, item) => sum + item.value, 0);
    card.style.display = "block";
    card.querySelector(".kb-amount").textContent = formatAmount(totalValue, currency);
    const note = card.querySelector(".kb-note");
    note.textContent = "Preračunavam u BAM…";
    try {
      note.textContent = formatAmount(totalValue * await rateToBam(currency), "BAM");
    } catch {
      note.textContent = "BAM kurs trenutno nije dostupan";
    }
  }

  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(update, 100);
  }

  getCard().style.display = "none";
  update();
  new MutationObserver(scheduleUpdate).observe(document.body, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ["class", "checked", "value"]
  });
  addEventListener("click", () => setTimeout(scheduleUpdate, 80), true);
  addEventListener("input", scheduleUpdate, true);
})();
