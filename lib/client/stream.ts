export type StreamEvent = { event: string; data: unknown };
export function createEventParser(receive: (event: StreamEvent) => void) {
  let buffer = "";
  return {
    push(chunk: string) {
      buffer += chunk;
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        let event = "message";
        const data: string[] = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (data.length) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(data.join("\n"));
          } catch {
            continue;
          }
          receive({ event, data: parsed });
        }
      }
    },
  };
}
export function safeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
