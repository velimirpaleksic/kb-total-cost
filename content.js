(() => {
  "use strict";
  if (window.top !== window.self) return;

  const CARD_ID = "kb-total-cost-card";
  const TOTAL_RE = /total\s*(?:cost|price)\s*:?/i;
  const MONEY_RE = /(?:US\s*\$|USD|€|EUR|CN\s*¥|CNY|RMB|¥|￥|£|GBP|KM|BAM)\s*([\d.,]+)|([\d.,]+)\s*(?:US\s*\$|USD|€|EUR|CNY|RMB|元|£|GBP|KM|BAM)/i;
  const rateCache = new Map();
  let scheduled = false;

  function parseMoney(text) {
    const match = String(text || "").replace(/\u00a0/g, " ").match(MONEY_RE);
    if (!match) return null;
    let raw = (match[1] || match[2]).trim();
    if (raw.includes(",") && raw.includes(".")) raw = raw.replace(/,/g, "");
    else if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(raw)) raw = raw.replace(/\./g, "").replace(",", ".");
    else raw = raw.replace(/,/g, "");
    const value = Number(raw);
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
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!TOTAL_RE.test(node.nodeValue || "")) continue;
      const labelElement = node.parentElement;
      if (!isVisible(labelElement)) continue;

      let container = labelElement;
      let money = null;
      for (let depth = 0; depth < 5 && container; depth += 1) {
        const text = (container.textContent || "").replace(/\s+/g, " ").trim();
        const labelIndex = text.search(TOTAL_RE);
        const afterLabel = labelIndex >= 0 ? text.slice(labelIndex).replace(TOTAL_RE, "").trim() : "";
        money = parseMoney(afterLabel);
        if (money) break;
        container = container.parentElement;
      }
      if (!money || !container || (container.textContent || "").length > 500) continue;
      const box = labelElement.getBoundingClientRect();
      found.push({ ...money, x: box.left, y: box.top });
    }

    return found.filter((item, index, list) =>
      list.findIndex(other => other.currency === item.currency && other.value === item.value &&
        Math.abs(other.x - item.x) < 3 && Math.abs(other.y - item.y) < 3) === index
    );
  }

  function formatAmount(value, currency) {
    return new Intl.NumberFormat("bs-BA", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
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
    try { note.textContent = formatAmount(totalValue * await rateToBam(currency), "BAM"); }
    catch { note.textContent = "BAM kurs trenutno nije dostupan"; }
  }

  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(update, 120);
  }

  getCard().style.display = "none";
  update();
  new MutationObserver(scheduleUpdate).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "checked", "value"] });
  addEventListener("click", () => setTimeout(scheduleUpdate, 100), true);
  addEventListener("input", scheduleUpdate, true);
  setInterval(scheduleUpdate, 2000);
})();
