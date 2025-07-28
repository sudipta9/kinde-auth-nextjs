import { removeTrailingSlash } from "../utils/removeTrailingSlash";
import { config, routes } from "../config/index";
import RouterClient from "../routerClients/RouterClient";

export const callback = async (routerClient: RouterClient) => {
  const errorParam = routerClient.getSearchParam("error");
  if (errorParam) {
    if (errorParam?.toLowerCase() === "login_link_expired") {
      const reauthState = routerClient.getSearchParam("reauth_state");
      if (reauthState) {
        const decodedAuthState = atob(reauthState);
        try {
          const reauthState = JSON.parse(decodedAuthState);
          if (reauthState) {
            const urlParams = new URLSearchParams(reauthState);
            const loginRoute = new URL(
              `${config.redirectURL}${config.apiPath}/${routes.login}`,
            );
            loginRoute.search = urlParams.toString();
            return routerClient.redirect(loginRoute.toString());
          }
        } catch (ex) {
          throw new Error(
            ex instanceof Error
              ? ex.message
              : "Unknown Error parsing reauth state",
          );
        }
      }
      return;
    }
    return;
  }

  const postLoginRedirectURLFromMemory =
    (await routerClient.sessionManager.getSessionItem(
      "post_login_redirect_url",
    )) as string;

  if (postLoginRedirectURLFromMemory) {
    await routerClient.sessionManager.removeSessionItem(
      "post_login_redirect_url",
    );
  }

  const postLoginRedirectURL = postLoginRedirectURLFromMemory
    ? postLoginRedirectURLFromMemory
    : config.postLoginRedirectURL;
  try {
    await routerClient.kindeClient.handleRedirectToApp(
      routerClient.sessionManager,
      routerClient.getUrl(),
    );
  } catch (error) {
    if (config.isDebugMode) {
      console.error("callback", error);
    }

    if (error.message.includes("Expected: State not found")) {
      return routerClient.json(
        {
          error:
            `Error: State not found.\nTo resolve this error please visit our docs https://docs.kinde.com/developer-tools/sdks/backend/nextjs-sdk/#state-not-found-error` +
            error.message,
        },
        { status: 500 },
      );
    }

    return routerClient.json({ error: error.message }, { status: 500 });
  }

  // Compile regex once at startup
  const compiledRegex = (() => {
    if (!config.postLoginAllowedURLRegex) {
      return null;
    }
    try {
      return new RegExp(config.postLoginAllowedURLRegex);
    } catch (error) {
      console.error("Invalid postLoginAllowedURLRegex pattern:", error);
      throw new Error(
        `Invalid postLoginAllowedURLRegex pattern: ${error.message}`,
      );
    }
  })();

  const isRedirectAllowed = (url: string) => {
    if (!config.postLoginAllowedURLRegex) {
      return true;
    }
    return compiledRegex!.test(url);
  };

  const state = (await routerClient.sessionManager.getSessionItem(
    "state",
  )) as string;
  await routerClient.sessionManager.removeSessionItem("state");

  if (postLoginRedirectURL && isRedirectAllowed(postLoginRedirectURL)) {
    const url = postLoginRedirectURL.startsWith("http")
      ? new URL(postLoginRedirectURL)
      : new URL(
          removeTrailingSlash(
            new URL(routerClient.clientConfig.siteUrl).pathname,
          ) + postLoginRedirectURL,
          new URL(routerClient.clientConfig.siteUrl),
        );
    state && url.searchParams.set("state", state);

    return routerClient.redirect(url.toString());
  }

  const url = new URL(routerClient.clientConfig.siteUrl);
  state && url.searchParams.set("state", state);
  return routerClient.redirect(url.toString());
};
