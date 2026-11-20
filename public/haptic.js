(function () {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function quiet() {
    return motion.matches;
  }

  function arm(button) {
    if (!(button instanceof HTMLButtonElement) || button.querySelector(":scope > [data-haptic]")) return;
    if (getComputedStyle(button).position === "static") button.style.position = "relative";
    const label = document.createElement("label");
    label.setAttribute("data-haptic", "");
    label.setAttribute("aria-hidden", "true");
    label.style.position = "absolute";
    label.style.inset = "0";
    label.style.zIndex = "3";
    label.style.margin = "0";
    label.style.touchAction = "inherit";
    label.style.webkitTapHighlightColor = "transparent";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.tabIndex = -1;
    input.setAttribute("switch", "");
    input.setAttribute("aria-hidden", "true");
    input.style.position = "absolute";
    input.style.width = "1px";
    input.style.height = "1px";
    input.style.margin = "0";
    input.style.opacity = "0";
    input.style.visibility = "hidden";
    input.addEventListener("click", (event) => event.stopPropagation());
    label.append(input);
    button.append(label);
  }

  function scan(root) {
    if (quiet() || !root) return;
    if (root instanceof HTMLButtonElement) arm(root);
    if (root.querySelectorAll) root.querySelectorAll("button").forEach(arm);
  }

  scan(document);
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) scan(node);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("pointerdown", (event) => {
    if (quiet()) return;
    const target = event.target;
    const button = target instanceof Element && target.closest("button");
    if (!button || button.disabled) return;
    if (typeof navigator.vibrate === "function") navigator.vibrate(15);
  }, { passive: true });
})();
