// Current task state is asserted by the signed Paperclip task controller.
// A standing Agent Chat uses its own active-conversation lifecycle, not an
// in-progress work issue. Never interpret an idle/waiting chat as an active run.
export function activeReadContext(task) {
  if (!task || typeof task !== "object" || typeof task.id !== "string" ||
      typeof task.identifier !== "string") return false;
  if (task.mode === "task" || task.mode === undefined)
    return task.status === "in_progress";
  if (task.mode !== "chat") return false;
  return task.conversationState === "active" &&
    ["in_progress","in_review","todo","backlog"].includes(task.status);
}
