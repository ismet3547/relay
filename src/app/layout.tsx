import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Relay — Your local workspace", description: "Real local video transcription, synchronized transcripts, and an interactive operations demo." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
