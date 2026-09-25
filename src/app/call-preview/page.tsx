import { notFound } from "next/navigation";
import { CallLayoutPreview } from "@/components/chat/CallLayoutPreview";

export default function CallPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <CallLayoutPreview />;
}
