export interface SiteOption {
  id: string;
  name: string;
  chance: string;
  detail: string;
  good: boolean;
}

export interface SiteMenu {
  render(current: string, intro: string, rows: SiteOption[]): void;
}

export function siteMenu(pick: (id: string) => void): SiteMenu {
  const root = document.getElementById("site-field")!;
  const toggle = document.getElementById("site-open")!;
  const name = document.getElementById("site-current")!;
  const popover = document.getElementById("site-popover")!;
  const intro = document.getElementById("site-intro")!;
  const list = document.getElementById("site-menu")!;
  let options: HTMLLIElement[] = [];

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
    render(current, introText, rows) {
      name.textContent = rows.find((row) => row.id === current)!.name;
      intro.textContent = introText;
      options = rows.map((row) => {
        const option = document.createElement("li");
        option.role = "option";
        option.tabIndex = -1;
        option.setAttribute("aria-selected", String(row.id === current));
        option.innerHTML = `<span class="option-name">${row.name}</span><span class="option-chance${row.good ? "" : " short"}">${row.chance}</span><span class="option-note">${row.detail}</span>`;
        option.addEventListener("click", () => {
          close();
          toggle.focus();
          pick(row.id);
        });
        return option;
      });
      list.replaceChildren(...options);
    },
  };
}
