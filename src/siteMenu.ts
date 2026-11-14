import type { Site } from "./data";

export interface SiteMenu {
  render(current: string, chanceOf: (id: string) => string): void;
}

export function siteMenu(sites: Site[], pick: (id: string) => void): SiteMenu {
  const root = document.getElementById("site-field")!;
  const toggle = document.getElementById("site-open")!;
  const name = document.getElementById("site-current")!;
  const popover = document.getElementById("site-popover")!;
  const list = document.getElementById("site-menu")!;
  const options = sites.map((site) => {
    const option = document.createElement("li");
    option.role = "option";
    option.tabIndex = -1;
    option.dataset.site = site.id;
    option.innerHTML = `<span class="option-name">${site.name}</span><span class="option-chance"></span><span class="option-note">${site.note}</span>`;
    option.addEventListener("click", () => {
      close();
      toggle.focus();
      pick(site.id);
    });
    return option;
  });
  list.replaceChildren(...options);

  function close() {
    popover.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  }

  toggle.addEventListener("click", () => {
    if (!popover.hidden) return close();
    popover.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    (options.find((o) => o.getAttribute("aria-selected") === "true") ?? options[0]).focus();
  });
  list.addEventListener("keydown", (event) => {
    const index = options.indexOf(document.activeElement as HTMLLIElement);
    if (event.key === "ArrowDown") options[Math.min(options.length - 1, index + 1)].focus();
    else if (event.key === "ArrowUp") options[Math.max(0, index - 1)].focus();
    else if (event.key === "Enter" || event.key === " ") options[index].click();
    else return;
    event.preventDefault();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    close();
    toggle.focus();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!root.contains(event.target as Node)) close();
  });

  return {
    render(current, chanceOf) {
      name.textContent = sites.find((site) => site.id === current)!.name;
      for (const option of options) {
        option.setAttribute("aria-selected", String(option.dataset.site === current));
        option.querySelector(".option-chance")!.textContent = chanceOf(option.dataset.site!);
      }
    },
  };
}
