export async function onRequest(context) {
  const url = new URL(context.request.url);
  const allowedHosts = ['puzzle.game.mrwuliu.top'];

  if (!allowedHosts.includes(url.hostname)) {
    const redirectUrl = new URL(url.pathname, 'https://puzzle.game.mrwuliu.top');
    redirectUrl.search = url.search;
    return Response.redirect(redirectUrl.toString(), 301);
  }

  return context.next();
}
