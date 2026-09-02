import { RouteSkeleton } from "@/components/ui/RouteSkeleton";

export default function Loading() {
  return <RouteSkeleton cards={3} layout="list" aside />;
}
