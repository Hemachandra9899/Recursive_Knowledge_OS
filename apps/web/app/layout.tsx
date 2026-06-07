import "./globals.css";
import { QueryProvider } from "../providers/QueryProvider";

export const metadata = {
  title: "RLM Forge",
  description: "Recursive AI Research + Knowledge OS",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
