import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

type Props = { source: string };

export function Markdown({ source }: Props) {
	return <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{source}</ReactMarkdown>;
}
