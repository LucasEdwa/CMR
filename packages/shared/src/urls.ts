// Invitation links carry their secret in the path (/invite/<token>, /api/invitations/<token>), and
// query strings carry reset tokens, search terms and filters. Logs and error reports get this
// version of a URL instead: the path only, with link secrets replaced.
export function redactUrl(url: string): string {
  return url.split(/[?#]/)[0]!.replace(/\/(invite|invitations)\/[^/]+/, '/$1/[token]')
}
