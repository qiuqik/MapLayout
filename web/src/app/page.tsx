'use client';
import Header from "@/components/Header"
import CoreMap from "@/components/map/CoreMap"
import LeftCard from "@/components/left/leftCard"
import RightCard from "@/components/right/rightCard";

export default function Page() {
  return (
    <div className="relative w-screen h-screen overflow-hidden">
      <Header />
      <CoreMap />
      <LeftCard />
      <RightCard />
    </div>
  )
}