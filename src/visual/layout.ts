export interface CanvasPosition {
  x: number;
  y: number;
}

const nodeWidth = 280;
const nodeHeight = 188;
const horizontalClearance = 40;
const verticalClearance = 32;
const rowStep = 240;
const gridSize = 20;

export function findOpenNodePosition(desired: CanvasPosition, occupied: CanvasPosition[]): CanvasPosition {
  const origin = { x: snap(desired.x), y: snap(desired.y) };
  for (let row = 0; row < 200; row += 1) {
    const candidate = { x: origin.x, y: origin.y + row * rowStep };
    if (occupied.every((position) => !overlaps(candidate, position))) return candidate;
  }
  return { x: origin.x + gridSize, y: origin.y + occupied.length * rowStep };
}

export function positionsOverlap(left: CanvasPosition, right: CanvasPosition): boolean {
  return overlaps(left, right);
}

function overlaps(left: CanvasPosition, right: CanvasPosition): boolean {
  return Math.abs(left.x - right.x) < nodeWidth + horizontalClearance
    && Math.abs(left.y - right.y) < nodeHeight + verticalClearance;
}

function snap(value: number): number {
  return Math.round(value / gridSize) * gridSize;
}
