import { randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Random uppercase letters. Length starts at 3 and grows only when that length is full. */
export function allocateProjectCode(existing: ReadonlySet<string>): string {
	let length = 3;
	while (length < 12) {
		const space = 26 ** length;
		let taken = 0;
		for (const code of existing) {
			if (code.length === length && isLetters(code)) taken += 1;
		}
		if (taken >= space) {
			length += 1;
			continue;
		}
		const remaining = space - taken;
		if (remaining > 64) {
			for (let attempt = 0; attempt < 32; attempt++) {
				const code = randomLetters(length);
				if (!existing.has(code)) return code;
			}
		}
		const pick = randomInt(0, remaining);
		let seen = 0;
		for (let index = 0; index < space; index++) {
			const code = codeAt(length, index);
			if (existing.has(code)) continue;
			if (seen === pick) return code;
			seen += 1;
		}
		length += 1;
	}
	throw new Error("project code space exhausted");
}

function randomLetters(length: number): string {
	let code = "";
	for (let i = 0; i < length; i++) code += ALPHABET[randomInt(0, ALPHABET.length)];
	return code;
}

function codeAt(length: number, index: number): string {
	let n = index;
	const chars: string[] = Array.from({ length }, () => "A");
	for (let i = length - 1; i >= 0; i--) {
		chars[i] = ALPHABET[n % 26] ?? "A";
		n = Math.floor(n / 26);
	}
	return chars.join("");
}

function isLetters(code: string): boolean {
	if (code.length === 0) return false;
	for (const char of code) {
		if (!ALPHABET.includes(char)) return false;
	}
	return true;
}
