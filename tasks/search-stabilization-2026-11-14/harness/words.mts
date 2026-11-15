// Print the matcher's class and corpus document frequency for each word (read-only).
import { classifyWord, corpusDf } from '@/lib/discovery/matcher';
for (const w of process.argv.slice(2)) {
  const c = classifyWord(w);
  console.log(w.padEnd(14), c.cls.padEnd(12), c.basis.padEnd(24), corpusDf(w).toFixed(4));
}
