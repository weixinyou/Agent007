export function addItems(inventory: Record<string, number>, items: Record<string, number>): void {
  for (const [key, value] of Object.entries(items)) {
    inventory[key] = (inventory[key] ?? 0) + value;
  }
}

export function removeItems(inventory: Record<string, number>, items: Record<string, number>): boolean {
  for (const [key, value] of Object.entries(items)) {
    if ((inventory[key] ?? 0) < value) {
      return false;
    }
  }

  for (const [key, value] of Object.entries(items)) {
    inventory[key] = (inventory[key] ?? 0) - value;
    if (inventory[key] <= 0) {
      delete inventory[key];
    }
  }

  return true;
}
