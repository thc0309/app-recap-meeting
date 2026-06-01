import ReactMarkdown from "react-markdown";

interface RecapPanelProps {
  recapMarkdown: string | null;
}

export function RecapPanel({ recapMarkdown }: RecapPanelProps) {
  if (!recapMarkdown?.trim()) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
        Generate a recap after the transcript is ready.
      </div>
    );
  }

  return (
    <article className="prose prose-sm dark:prose-invert max-w-none rounded-2xl border border-border bg-card/80 px-5 py-4">
      <ReactMarkdown>{recapMarkdown}</ReactMarkdown>
    </article>
  );
}
