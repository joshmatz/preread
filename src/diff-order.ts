// Line matching supplies useful word highlights but interleaves unified rows.
// Move the existing rows so each changed block keeps Git's deletion/addition order.
export function orderUnifiedChanges(root: HTMLElement) {
  for (const body of root.querySelectorAll(".d2h-file-diff .d2h-diff-tbody")) {
    let firstAddition: HTMLTableRowElement | null = null;
    for (const row of body.querySelectorAll<HTMLTableRowElement>("tr")) {
      if (row.querySelector("td.d2h-del")) {
        if (firstAddition) body.insertBefore(row, firstAddition);
      } else if (row.querySelector("td.d2h-ins")) {
        firstAddition ??= row;
      } else {
        firstAddition = null;
      }
    }
  }
}
