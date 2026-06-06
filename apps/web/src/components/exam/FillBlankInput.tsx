export function FillBlankInput({
  blanks,
  value,
  onChange,
}: {
  blanks: { id: string; content: string }[];
  value: Record<string, string>;
  onChange: (answer: unknown) => void;
}) {
  function handleChange(id: string, text: string) {
    onChange({ ...value, [id]: text });
  }

  return (
    <div className="space-y-4">
      {blanks.map((blank, i) => (
        <div key={blank.id} className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">
            第{i + 1}空:
          </span>
          <input
            type="text"
            value={value[blank.id] ?? ""}
            onChange={(e) => handleChange(blank.id, e.target.value)}
            className="flex-1 rounded-md border px-3 py-2 text-sm"
            placeholder="请输入答案"
          />
        </div>
      ))}
    </div>
  );
}
