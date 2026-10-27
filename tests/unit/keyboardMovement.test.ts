import { describe, expect, it, vi } from "vitest";
import { appendEditorHistorySnapshot, editorHistoryEntry } from "@/lib/editorHistory";
import { createKeyboardMovementInteraction, moveShapesByKeyboard, type KeyboardMovementEvent, type KeyboardMovementView } from "@/lib/keyboardMovement";
import { horizontalPlacementWorkplane, type PlacementWorkplane } from "@/lib/placementWorkplane";
import type { WorkplaneShape } from "@/types/sketchforge";

function box(id = "box", locked = false): WorkplaneShape {
  return { id, name: id, kind: "box", color: "#123456", x: 0, z: 0, elevation: 0,
    size: 20, width: 20, depth: 20, height: 20, rotation: 0, locked };
}

function key(key: string, overrides: Partial<KeyboardMovementEvent> = {}): KeyboardMovementEvent {
  return { key, repeat: false, ctrlKey: false, metaKey: false, shiftKey: false, ...overrides };
}

function editorHarness(initial = [box()], selectedIds = ["box"]) {
  let shapes = initial;
  let history = [editorHistoryEntry(shapes, selectedIds)];
  let index = 0;
  let busy = false;
  const save = vi.fn();
  const begin = vi.fn(() => {
    if (busy || !shapes.some((shape) => selectedIds.includes(shape.id) && !shape.locked)) return false;
    busy = true;
    return true;
  });
  const movement = createKeyboardMovementInteraction({
    begin,
    move: (event) => { shapes = moveShapesByKeyboard(shapes, selectedIds, event, horizontalPlacementWorkplane()); },
    end: () => {
      busy = false;
      const appended = appendEditorHistorySnapshot(history, index, editorHistoryEntry(shapes, selectedIds));
      history = appended.entries;
      index = appended.index;
      if (appended.changed) save(shapes);
    },
  });
  return {
    movement, save, begin,
    get shapes() { return shapes; },
    get history() { return history; },
    setBusy() { busy = true; },
    undo() { shapes = history[--index].shapes; },
    redo() { shapes = history[++index].shapes; },
  };
}

describe("keyboard movement interactions", () => {
  it.each([
    ["ArrowRight", {}, "x", 31],
    ["ArrowLeft", {}, "x", -31],
    ["ArrowUp", {}, "z", -31],
    ["ArrowDown", {}, "z", 31],
    ["ArrowUp", { ctrlKey: true }, "elevation", 31],
    ["ArrowDown", { metaKey: true, shiftKey: true }, "elevation", -155],
  ] as const)("batches a held %s into one undo step and save", (name, modifiers, coordinate, expected) => {
    const editor = editorHarness();
    editor.movement.keyDown(key(name, modifiers));
    for (let repeat = 0; repeat < 30; repeat++) editor.movement.keyDown(key(name, { ...modifiers, repeat: true }));
    expect(editor.shapes[0][coordinate]).toBe(expected);
    expect(editor.history).toHaveLength(1);
    expect(editor.save).not.toHaveBeenCalled();
    expect(editor.begin).toHaveBeenCalledTimes(1);

    editor.movement.keyUp(name);
    expect(editor.history).toHaveLength(2);
    expect(editor.save).toHaveBeenCalledTimes(1);
    editor.undo();
    expect(editor.shapes[0][coordinate]).toBe(0);
    editor.redo();
    expect(editor.shapes[0][coordinate]).toBe(expected);
  });

  it("keeps rapid discrete taps as separate undo steps", () => {
    const editor = editorHarness();
    for (let tap = 0; tap < 3; tap++) {
      editor.movement.keyDown(key("ArrowRight"));
      editor.movement.keyUp("ArrowRight");
    }
    expect(editor.history).toHaveLength(4);
    expect(editor.save).toHaveBeenCalledTimes(3);
    editor.undo();
    expect(editor.shapes[0].x).toBe(2);
    editor.undo();
    expect(editor.shapes[0].x).toBe(1);
  });

  it("ends overlapping movement keys only when the last arrow is released", () => {
    const editor = editorHarness();
    editor.movement.keyDown(key("ArrowRight"));
    editor.movement.keyDown(key("ArrowUp"));
    editor.movement.keyUp("ArrowRight");
    editor.movement.keyUp("Control");
    expect(editor.save).not.toHaveBeenCalled();
    editor.movement.keyDown(key("ArrowUp", { repeat: true, ctrlKey: true }));
    editor.movement.keyUp("ArrowUp");
    expect(editor.shapes[0]).toMatchObject({ x: 1, z: -1, elevation: 1 });
    expect(editor.save).toHaveBeenCalledTimes(1);
  });

  it("finishes interrupted holds once and ignores stale repeats until a fresh press", () => {
    const editor = editorHarness();
    editor.movement.keyDown(key("ArrowRight"));
    editor.movement.finish(); // Focus loss, another command, navigation, or pointer input.
    editor.movement.finish();
    editor.movement.keyUp("ArrowRight");
    expect(editor.movement.keyDown(key("ArrowRight", { repeat: true }))).toBe(false);
    expect(editor.save).toHaveBeenCalledTimes(1);
    expect(editor.shapes[0].x).toBe(1);
    editor.movement.keyDown(key("ArrowRight"));
    editor.movement.keyUp("ArrowRight");
    expect(editor.shapes[0].x).toBe(2);
    expect(editor.save).toHaveBeenCalledTimes(2);
  });

  it("does not create an entry for a hold that returns to its starting position", () => {
    const editor = editorHarness();
    editor.movement.keyDown(key("ArrowRight"));
    editor.movement.keyDown(key("ArrowLeft"));
    editor.movement.keyUp("ArrowRight");
    editor.movement.keyUp("ArrowLeft");
    expect(editor.history).toHaveLength(1);
    expect(editor.save).not.toHaveBeenCalled();
  });

  it("respects locked objects, empty selections, and an active pointer transform", () => {
    for (const editor of [editorHarness([box("box", true)]), editorHarness([box()], [])]) {
      expect(editor.movement.keyDown(key("ArrowRight"))).toBe(false);
      editor.movement.keyUp("ArrowRight");
      expect(editor.history).toHaveLength(1);
      expect(editor.save).not.toHaveBeenCalled();
    }
    const editor = editorHarness();
    editor.setBusy();
    expect(editor.movement.keyDown(key("ArrowRight"))).toBe(false);
    editor.movement.finish();
    expect(editor.save).not.toHaveBeenCalled();
  });

  it("moves only unlocked selected objects along the active workplane axes", () => {
    const shapes = [box(), box("locked", true), box("other")];
    const plane: PlacementWorkplane = {
      origin: { x: 0, y: 0, z: 0 }, xAxis: { x: 0, y: 1, z: 0 },
      zAxis: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 },
    };
    const nudged = moveShapesByKeyboard(shapes, ["box", "locked"], key("ArrowRight", { shiftKey: true }), plane);
    expect(nudged[0]).toMatchObject({ x: 0, z: 0, elevation: 5 });
    expect(nudged[1]).toBe(shapes[1]);
    expect(nudged[2]).toBe(shapes[2]);
    const raised = moveShapesByKeyboard(nudged, ["box"], key("ArrowUp", { ctrlKey: true }), plane);
    expect(raised[0]).toMatchObject({ x: 0, z: 1, elevation: 5 });
  });

  describe("relative to the camera view", () => {
    const plane = horizontalPlacementWorkplane();
    // Camera basis from yaw (orbit around Y, 0 = default front view looking toward -Z) and pitch (down tilt).
    function view(yawDegrees: number, pitchDegrees = 45): KeyboardMovementView {
      const yaw = (yawDegrees * Math.PI) / 180;
      const pitch = (pitchDegrees * Math.PI) / 180;
      const right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
      const flat = { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
      const forward = { x: flat.x * Math.cos(pitch), y: -Math.sin(pitch), z: flat.z * Math.cos(pitch) };
      const up = { x: flat.x * Math.sin(pitch), y: Math.cos(pitch), z: flat.z * Math.sin(pitch) };
      return { right, up, forward };
    }
    function moved(name: string, camera: KeyboardMovementView, modifiers: Partial<KeyboardMovementEvent> = {}) {
      const [shape] = moveShapesByKeyboard([box()], ["box"], key(name, modifiers), plane, camera);
      return { x: shape.x, z: shape.z, elevation: shape.elevation };
    }

    it("matches the fixed axes in the default view", () => {
      expect(moved("ArrowRight", view(0))).toEqual({ x: 1, z: 0, elevation: 0 });
      expect(moved("ArrowUp", view(0))).toEqual({ x: 0, z: -1, elevation: 0 });
    });

    it.each([
      [90, { right: { x: 0, z: -1 }, up: { x: -1, z: 0 } }],
      [180, { right: { x: -1, z: 0 }, up: { x: 0, z: 1 } }],
      [-90, { right: { x: 0, z: 1 }, up: { x: 1, z: 0 } }],
      [30, { right: { x: 1, z: 0 }, up: { x: 0, z: -1 } }],
      [60, { right: { x: 0, z: -1 }, up: { x: -1, z: 0 } }],
    ])("follows the screen after orbiting %s degrees", (yaw, expected) => {
      expect(moved("ArrowRight", view(yaw))).toMatchObject(expected.right);
      expect(moved("ArrowLeft", view(yaw))).toMatchObject({ x: -expected.right.x || 0, z: -expected.right.z || 0 });
      expect(moved("ArrowUp", view(yaw))).toMatchObject(expected.up);
      expect(moved("ArrowDown", view(yaw))).toMatchObject({ x: -expected.up.x || 0, z: -expected.up.z || 0 });
    });

    it("moves away from the camera on ArrowUp from top-down and edge-on views", () => {
      expect(moved("ArrowUp", view(90, 90))).toMatchObject({ x: -1, z: 0 });
      expect(moved("ArrowUp", view(90, 0))).toMatchObject({ x: -1, z: 0 });
    });

    it("keeps Ctrl/Cmd+ArrowUp along the workplane normal", () => {
      expect(moved("ArrowUp", view(135), { ctrlKey: true })).toEqual({ x: 0, z: 0, elevation: 1 });
    });
  });

  describe("step size", () => {
    const plane = horizontalPlacementWorkplane();
    const moved = (gridStep: number | undefined, modifiers: Partial<KeyboardMovementEvent> = {}, name = "ArrowRight") =>
      moveShapesByKeyboard([box()], ["box"], key(name, modifiers), plane, null, gridStep)[0];

    it.each([
      [0.5, 0.5],
      [2, 2],
      [5, 5],
      [8, 8],
      [0, 1],
    ])("moves one snap-grid step of %s mm (%s mm)", (gridStep, expected) => {
      expect(moved(gridStep).x).toBe(expected);
      expect(moved(gridStep, { shiftKey: true }).x).toBe(expected * 5);
      expect(moved(gridStep, { ctrlKey: true }, "ArrowUp").elevation).toBe(expected);
    });

    it("keeps the upstream 1 mm step when no grid is given", () => {
      expect(moved(undefined).x).toBe(1);
    });

    it("does not accumulate float noise with fine steps", () => {
      let shapes = [box()];
      for (let i = 0; i < 3; i++) shapes = moveShapesByKeyboard(shapes, ["box"], key("ArrowRight"), plane, null, 0.1);
      expect(shapes[0].x).toBe(0.3);
    });
  });
});

