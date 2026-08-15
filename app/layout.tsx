import type { Metadata } from "next";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "BPMN → Visio Lab",
  description: "Converta BPMN 2.0 em arquivos Visio editáveis com tecnologia open source.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
