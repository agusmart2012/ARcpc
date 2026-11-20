function restSeconds(text) {
  const raw = String(text || "").replace(/[“”″]/g, '"').trim();
  if (!raw) return 0;
  const clock = raw.match(/(\d{1,2}):(\d{2})/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const minutes = raw.match(/(\d+(?:[.,]\d+)?)\s*min/);
  if (minutes) return Math.round(Number(minutes[1].replace(",", ".")) * 60);
  const seconds = raw.match(/(\d+)\s*(?:"|''|segundos?\b|seg\b|s\b)/i);
  if (seconds) return Number(seconds[1]);
  return 0;
}

if (typeof module !== "undefined" && module.exports) module.exports = { restSeconds };
