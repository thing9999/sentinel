import { redirect } from "next/navigation";

// shell.md 3.1: `/cluster` 는 개요로 이동한다
export default function ClusterIndex() {
  redirect("/");
}
