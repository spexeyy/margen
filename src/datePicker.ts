import { GOOD_CHANCE, percent } from "./mission";

const DAY_MS = 86400000;

export interface DatePicker {
  render(date: number, chances: number[]): void;
}

export function datePicker(firstDay: number, dates: number, pick: (date: number) => void): DatePicker {
  const root = document.getElementById("date-field")!;
  const toggle = document.getElementById("date-open")!;
  const popover = document.getElementById("date-popover")!;
  const monthName = document.getElementById("month-name")!;
  const days = document.getElementById("days")!;
  const previous = document.getElementById("month-prev") as HTMLButtonElement;
  const next = document.getElementById("month-next") as HTMLButtonElement;
  const start = new Date(firstDay);
  const lastMonth = new Date(firstDay + (dates - 1) * DAY_MS).getUTCMonth() - start.getUTCMonth();
  let current = 0;
  let chances: number[] = [];
  let month = 0;

  const monthOf = (date: number) => new Date(firstDay + date * DAY_MS).getUTCMonth() - start.getUTCMonth();

  function draw() {
    const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + month, 1));
    const year = first.getUTCFullYear();
    const index = first.getUTCMonth();
    monthName.textContent = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const lead = (first.getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
    const cells: HTMLElement[] = Array.from({ length: lead }, () => document.createElement("span"));
    for (let day = 1; day <= count; day++) {
      const date = Math.round((Date.UTC(year, index, day) - firstDay) / DAY_MS);
      const cell = document.createElement("button");
      cell.type = "button";
      cell.textContent = String(day);
      cell.disabled = date < 0 || date >= dates;
      if (!cell.disabled) {
        cell.style.setProperty("--chance", String(chances[date]));
        cell.classList.toggle("good", chances[date] >= GOOD_CHANCE);
        cell.classList.toggle("some", chances[date] > 0 && chances[date] < GOOD_CHANCE);
        cell.setAttribute("aria-pressed", String(date === current));
        cell.title = `${percent(chances[date])} chance`;
        cell.onclick = () => {
          close();
          pick(date);
        };
      }
      cells.push(cell);
    }
    days.replaceChildren(...cells);
    previous.disabled = month === 0;
    next.disabled = month === lastMonth;
  }

  function close() {
    popover.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  }

  toggle.addEventListener("click", () => {
    if (!popover.hidden) return close();
    month = monthOf(current);
    draw();
    popover.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
  });
  previous.addEventListener("click", () => {
    month--;
    draw();
  });
  next.addEventListener("click", () => {
    month++;
    draw();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!root.contains(event.target as Node)) close();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  return {
    render(date, newChances) {
      current = date;
      chances = newChances;
      toggle.textContent = new Date(firstDay + date * DAY_MS).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
      if (!popover.hidden) draw();
    },
  };
}
