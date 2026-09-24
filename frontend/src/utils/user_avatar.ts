const colors = ["bg-indigo-700", "bg-emerald-600", "bg-violet-600", "bg-amber-600", "bg-rose-600"];

export function userAvatarColor(userId: string): string {
  const index = userId.split("").reduce((total, character) => total + character.charCodeAt(0), 0) % colors.length;
  return colors[index];
}

export function userAvatarInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() || "U";
}
