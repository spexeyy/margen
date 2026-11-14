const root = document.documentElement;

export function color(name: string): string {
  return getComputedStyle(root).getPropertyValue(`--${name}`).trim();
}

export function isLight(): boolean {
  return root.dataset.theme === "light";
}

export function onThemeChange(render?: () => void): void {
  const button = document.getElementById("theme")!;
  const label = () => button.setAttribute("aria-label", `Switch to ${isLight() ? "dark" : "light"} mode`);
  label();
  button.addEventListener("click", () => {
    root.dataset.theme = isLight() ? "dark" : "light";
    localStorage.setItem("theme", root.dataset.theme);
    label();
    render?.();
  });
}
