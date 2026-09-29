// node:test reporter for GitHub Actions: every failing test becomes an
// ::error annotation, readable without downloading the job logs.
export default async function* githubAnnotations(source) {
  for await (const event of source) {
    if (event.type !== 'test:fail' || event.data.details?.error?.failureType === 'subtestsFailed') continue;
    const { name, file, line, details } = event.data;
    const err = details?.error?.cause ?? details?.error;
    const message = String(err?.message ?? err ?? 'failed').replace(/\r?\n/g, '%0A').slice(0, 1500);
    const where = file ? `file=${file.replace(/^file:\/\//, '')},line=${line ?? 1},` : '';
    yield `::error ${where}title=${name.replace(/[,:]/g, ' ')}::${message}\n`;
  }
}
