function colorEnabled(stream: NodeJS.WriteStream = process.stdout): boolean {
	if (process.env.NO_COLOR !== undefined) return false;
	if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") return true;
	return Boolean(stream.isTTY);
}

function paint(stream: NodeJS.WriteStream, codes: string, text: string): string {
	if (!colorEnabled(stream)) return text;
	return `\u001b[${codes}m${text}\u001b[0m`;
}

export function createAnsi(stream: NodeJS.WriteStream = process.stdout) {
	const p = (codes: string, text: string) => paint(stream, codes, text);
	return {
		bold: (text: string) => p("1", text),
		dim: (text: string) => p("2", text),
		cyan: (text: string) => p("36", text),
		blue: (text: string) => p("34", text),
		magenta: (text: string) => p("35", text),
		green: (text: string) => p("32", text),
		yellow: (text: string) => p("33", text),
		red: (text: string) => p("31", text),
		greenBold: (text: string) => p("1;32", text),
		yellowBold: (text: string) => p("1;33", text),
		redBold: (text: string) => p("1;31", text),
		cyanBold: (text: string) => p("1;36", text),
	};
}
