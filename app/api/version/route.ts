import { NextResponse } from 'next/server';

export async function GET() {
  const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
  const versions = await res.json();
  return NextResponse.json({ version: versions[0] });
}