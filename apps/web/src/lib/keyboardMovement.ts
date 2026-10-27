import type { PlacementPoint, PlacementWorkplane } from "@/lib/placementWorkplane";
import { cleanNearZero } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/sketchforge";

export type KeyboardMovementEvent = Pick<KeyboardEvent, "key" | "repeat" | "ctrlKey" | "metaKey" | "shiftKey">;

/** World-space camera basis: `right` and `up` of the screen, `forward` into the screen. */
export type KeyboardMovementView = { right: PlacementPoint; up: PlacementPoint; forward: PlacementPoint };

export function isMovementKey(key: string) {
  return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key);
}

function dot(a: PlacementPoint, b: PlacementPoint) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function scaled(a: PlacementPoint, factor: number): PlacementPoint {
  return { x: a.x * factor, y: a.y * factor, z: a.z * factor };
}

/**
 * Workplane directions for ArrowRight and ArrowUp. Without a view they are the fixed
 * workplane axes (+X, -Z). With a view, each arrow uses the ±X/±Z workplane axis that
 * looks most like that screen direction, so orbiting the camera keeps arrows intuitive.
 * "Up" blends screen-up with the view direction: on a plane seen edge-on, ArrowUp
 * moves away from the camera.
 */
export function keyboardMovementAxes(workplane: PlacementWorkplane, view?: KeyboardMovementView | null) {
  if (!view) return { right: workplane.xAxis, up: scaled(workplane.zAxis, -1) };
  const away = { x: view.up.x + view.forward.x, y: view.up.y + view.forward.y, z: view.up.z + view.forward.z };
  const xRight = dot(workplane.xAxis, view.right);
  const zRight = dot(workplane.zAxis, view.right);
  const xAway = dot(workplane.xAxis, away);
  const zAway = dot(workplane.zAxis, away);
  const xIsRight = Math.abs(xRight) + Math.abs(zAway) >= Math.abs(zRight) + Math.abs(xAway);
  const sign = (value: number) => (value < 0 ? -1 : 1);
  return xIsRight
    ? { right: scaled(workplane.xAxis, sign(xRight)), up: scaled(workplane.zAxis, sign(zAway)) }
    : { right: scaled(workplane.zAxis, sign(zRight)), up: scaled(workplane.xAxis, sign(xAway)) };
}

/**
 * Moves the unlocked selected shapes one step per key press. `gridStep` is the snap grid in mm
 * (fork change, see FORK.md; upstream always used 1 mm); 0 means snapping is off and falls back
 * to 1 mm. Shift moves five steps.
 */
export function moveShapesByKeyboard(
  shapes: WorkplaneShape[], selectedIds: string[], event: KeyboardMovementEvent, workplane: PlacementWorkplane,
  view?: KeyboardMovementView | null, gridStep = 1,
) {
  if (!isMovementKey(event.key)) return shapes;
  const unit = gridStep > 0 ? gridStep : 1;
  const step = event.shiftKey ? unit * 5 : unit;
  const vertical = (event.ctrlKey || event.metaKey) && (event.key === "ArrowUp" || event.key === "ArrowDown");
  const planar = keyboardMovementAxes(workplane, view);
  const axis = vertical ? workplane.normal
    : event.key === "ArrowLeft" || event.key === "ArrowRight" ? planar.right : planar.up;
  const sign = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
  const delta = step * sign;
  const selected = new Set(selectedIds);
  let changed = false;
  const next = shapes.map((shape) => {
    if (!selected.has(shape.id) || shape.locked) return shape;
    // Rounded to 1e-6 mm so repeated fine steps (e.g. 0.1 mm) don't accumulate float noise.
    const settle = (value: number) => cleanNearZero(Math.round(value * 1e6) / 1e6);
    const x = settle(shape.x + axis.x * delta);
    const z = settle(shape.z + axis.z * delta);
    const elevation = settle((shape.elevation ?? 0) + axis.y * delta);
    if (x === shape.x && z === shape.z && elevation === (shape.elevation ?? 0)) return shape;
    changed = true;
    return { ...shape, x, z, elevation };
  });
  return changed ? next : shapes;
}

// Keep this controller independent of render closures: every repeat must move
// the latest scene, and rerenders must not end the press-to-release interaction.
export function createKeyboardMovementInteraction(callbacks: {
  begin: () => boolean;
  move: (event: KeyboardMovementEvent) => void;
  end: () => void;
}) {
  const pressed = new Set<string>();
  const finish = () => {
    if (pressed.size === 0) return;
    pressed.clear();
    callbacks.end();
  };
  return {
    keyDown(event: KeyboardMovementEvent) {
      if (!isMovementKey(event.key)) return false;
      // A repeat after focus loss or interruption cannot start a new gesture.
      if (pressed.size === 0 && (event.repeat || !callbacks.begin())) return false;
      pressed.add(event.key);
      callbacks.move(event);
      return true;
    },
    keyUp(key: string) {
      if (!pressed.has(key)) return;
      if (pressed.size === 1) finish();
      else pressed.delete(key);
    },
    finish,
  };
}
