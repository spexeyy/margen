const root = document.documentElement;

export function color(name: string): string {
  return getComputedStyle(root).getPropertyValue(`--${name}`).trim();
}

export function isLight(): boolean {
  return root.dataset.theme === "light";
}

export function onThemeChange(render?: () => void): void {
  const choices = document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]");
  const mark = () => choices.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.themeChoice === root.dataset.theme)));
  mark();
  for (const choice of choices) {
    choice.addEventListener("click", () => {
      root.dataset.theme = choice.dataset.themeChoice;
      localStorage.setItem("theme", root.dataset.theme!);
      mark();
      render?.();
    });
  }
}
