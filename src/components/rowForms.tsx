// Shared atoms for the inline row-editing pattern used by the
// Scheduled/Birthdays/Recurring lists.

export function DeleteRowButton({
  onDelete,
}: {
  onDelete: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      className="hidden shrink-0 rounded px-1.5 text-xs text-content-muted hover:text-danger group-hover:block"
      title="Delete"
      onClick={onDelete}
    >
      &#215;
    </button>
  );
}

export function EditFormButtons({ onCancel }: { onCancel: () => void }) {
  return (
    <span className="flex shrink-0 gap-1">
      <button type="submit" className="btn-primary px-3 py-1 text-xs">
        Save
      </button>
      <button
        type="button"
        className="rounded-md border border-line px-3 py-1 text-xs text-content-muted hover:text-content"
        onClick={onCancel}
      >
        Cancel
      </button>
    </span>
  );
}
