import { Quote } from "lucide-react";

type QuoteEntry = {
  text: string;
  author: string;
};

/** Curated motivational quotes shown one-per-day at the top of the Tasks page. */
const QUOTES: QuoteEntry[] = [
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  {
    text: "You don't have to be great to start, but you have to start to be great.",
    author: "Zig Ziglar",
  },
  { text: "Small steps every day add up to big results.", author: "Unknown" },
  {
    text: "Discipline is choosing between what you want now and what you want most.",
    author: "Abraham Lincoln",
  },
  {
    text: "Success is the sum of small efforts, repeated day in and day out.",
    author: "Robert Collier",
  },
  {
    text: "The best time to plant a tree was 20 years ago. The second best time is now.",
    author: "Chinese Proverb",
  },
  { text: "Action is the foundational key to all success.", author: "Pablo Picasso" },
  { text: "Focus on being productive instead of busy.", author: "Tim Ferriss" },
  { text: "A year from now you may wish you had started today.", author: "Karen Lamb" },
  { text: "Push yourself, because no one else is going to do it for you.", author: "Unknown" },
  {
    text: "Great things are done by a series of small things brought together.",
    author: "Vincent Van Gogh",
  },
  {
    text: "Motivation gets you going, but discipline keeps you growing.",
    author: "John C. Maxwell",
  },
  { text: "What you do today can improve all your tomorrows.", author: "Ralph Marston" },
  { text: "It's not about having time. It's about making time.", author: "Unknown" },
  {
    text: "The harder you work for something, the greater you'll feel when you achieve it.",
    author: "Unknown",
  },
  {
    text: "Don't wait for the perfect moment. Take the moment and make it perfect.",
    author: "Unknown",
  },
  { text: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" },
  {
    text: "Productivity is never an accident. It is always the result of a commitment to excellence.",
    author: "Paul J. Meyer",
  },
  { text: "Either you run the day, or the day runs you.", author: "Jim Rohn" },
  { text: "Start where you are. Use what you have. Do what you can.", author: "Arthur Ashe" },
  { text: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" },
  { text: "A little progress each day adds up to big results.", author: "Satya Nani" },
  {
    text: "Amateurs sit and wait for inspiration. The rest of us just get up and go to work.",
    author: "Stephen King",
  },
  { text: "Done is better than perfect.", author: "Sheryl Sandberg" },
  { text: "You don't need more time. You just need to decide.", author: "Unknown" },
  { text: "The distance between dreams and reality is called action.", author: "Unknown" },
  { text: "Do something today that your future self will thank you for.", author: "Unknown" },
  {
    text: "You can't go back and change the beginning, but you can start where you are and change the ending.",
    author: "C.S. Lewis",
  },
  {
    text: "The only limit to our realization of tomorrow will be our doubts of today.",
    author: "Franklin D. Roosevelt",
  },
];

/** Deterministic date -> index mapping so the same quote shows for the whole day
 * and then advances every midnight. A simple FNV-1a hash of the YYYY-MM-DD
 * string gives an even spread over the list for consecutive dates. */
function quoteIndexForDate(date: Date): number {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const seed = `${year}-${month}-${day}`;

  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash) % QUOTES.length;
}

export function DailyQuoteBanner() {
  const index = quoteIndexForDate(new Date());
  const quote = QUOTES[index]!;

  return (
    <div className="mb-6 flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Quote className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium italic text-foreground">&ldquo;{quote.text}&rdquo;</p>
        <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          — {quote.author}
        </p>
      </div>
    </div>
  );
}
