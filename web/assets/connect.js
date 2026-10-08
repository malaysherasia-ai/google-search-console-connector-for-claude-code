import { fill, GOOGLE_G, api, h, icon, initTheme, permissionLabel, siteKind, siteLabel } from "./common.js";

initTheme();

const panel = document.getElementById("panel");
const params = new URLSearchParams(location.search);
let state;

const track = (name, p) => {
  if (state?.telemetryConsent === "granted") api("/api/telemetry/event", { name, params: p }).catch(() => {});
};

const CLOUD = "https://console.cloud.google.com";

async function boot() {
  state = await api("/api/state");
  document.getElementById("project-name").textContent = state.projectName;
  // Clean ?error / ?signedIn out of the address bar after reading them.
  if (location.search) history.replaceState(null, "", "/connect");
  track("page_view", { page_title: "connect" });
  route(params.get("step") === "cloud" && state.telemetryConsent !== null ? "cloud" : undefined);
}

function route(force) {
  const view =
    force ??
    (state.telemetryConsent === null ? "consent" : !state.hasClient ? "cloud" : !state.connected ? "signin" : "property");
  setStepper(view);
  if (view !== "consent") track("connect_step", { step: view });
  ({ consent, cloud, signin, property, done })[view]();
  panel.querySelector("h2")?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function setStepper(view) {
  const order = ["cloud", "signin", "property"];
  const at = view === "done" ? 3 : view === "consent" ? -1 : order.indexOf(view);
  document.querySelectorAll("#stepper li").forEach((li, i) => {
    if (i < at) li.dataset.state = "done";
    else if (i === at) li.dataset.state = "current";
    else delete li.dataset.state;
    li.toggleAttribute("aria-current", i === at);
  });
}

function head(eyebrow, title, text) {
  return h("header", { class: "panel-head" }, eyebrow && h("p", { class: "eyebrow" }, eyebrow), h("h2", { tabindex: "-1" }, title), text && h("p", {}, text));
}

function errorAlert(message) {
  return h("div", { class: "alert alert-bad", role: "alert" }, icon("alert"), h("div", {}, message));
}

// ---------- Usage metrics consent ----------

async function consent() {
  const info = await api("/api/telemetry").catch(() => ({ events: {} }));
  const choose = async (choice) => {
    await api("/api/telemetry/consent", { consent: choice });
    state.telemetryConsent = choice;
    route();
  };
  fill(panel, 
    head(
      "Before you start",
      "Help improve this tool?",
      "Search Console Connector is free and open source. With your permission it sends anonymous usage events, such as which dashboard views get opened, so we can see what people use and what to fix.",
    ),
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "card-body" },
        h(
          "ul",
          { class: "consent-points" },
          h("li", {}, icon("check"), h("span", {}, h("strong", {}, "Sent if you say yes: "), "event names like “view changed”, the app version, your operating system and a random install ID.")),
          h("li", { class: "no" }, icon("x"), h("span", {}, h("strong", {}, "Never sent: "), "your websites, URLs, search queries, clicks or any other Search Console data, your Google account, or your tokens.")),
          h("li", {}, icon("check"), h("span", {}, "Events go to Google Analytics 4 from this app on your computer. No tracking script runs in your browser and no cookies are set.")),
          h("li", {}, icon("check"), h("span", {}, "You can change your answer any time in Settings, and see every event that was sent.")),
        ),
        h(
          "div",
          { class: "consent-choices" },
          h(
            "button",
            { class: "choice", type: "button", onclick: () => choose("granted") },
            icon("check"),
            h("div", {}, h("strong", {}, "Yes, share anonymous usage"), h("span", {}, "I believe open-source tools get better when they can see how they’re used.")),
          ),
          h(
            "button",
            { class: "choice", type: "button", onclick: () => choose("denied") },
            icon("x"),
            h("div", {}, h("strong", {}, "No, don’t share my usage"), h("span", {}, "Nothing is sent, and every feature works exactly the same.")),
          ),
        ),
        h(
          "details",
          { class: "disclosure" },
          h("summary", {}, "See the full list of events"),
          h(
            "div",
            { class: "event-list" },
            Object.entries(info.events || {}).map(([name, keys]) => h("div", {}, h("code", {}, name), keys.length ? h("span", { class: "muted" }, `  ${keys.join(", ")}`) : null)),
          ),
        ),
      ),
    ),
  );
}

// ---------- Step 1: Google Cloud ----------

function task(title, text, href, label = "Open") {
  return h(
    "li",
    {},
    h(
      "div",
      { class: "task-head" },
      h("strong", {}, title),
      href && h("a", { class: "btn", href, target: "_blank", rel: "noopener" }, label, icon("external")),
    ),
    h("p", {}, text),
  );
}

function cloud() {
  const errorBox = h("div", {});
  const idInput = h("input", { class: "input", id: "client-id", placeholder: "1234-abc.apps.googleusercontent.com", autocomplete: "off", spellcheck: "false" });
  const secretInput = h("input", { class: "input", id: "client-secret", type: "password", placeholder: "GOCSPX-…", autocomplete: "off" });
  const fileInput = h("input", { type: "file", accept: ".json,application/json", hidden: true });

  const save = async (payload) => {
    fill(errorBox, );
    try {
      await api("/api/client", payload);
      state.hasClient = true;
      route("signin");
    } catch (err) {
      fill(errorBox, errorAlert(err.message));
    }
  };

  const readFile = async (file) => {
    if (file) save({ json: await file.text() });
  };
  fileInput.addEventListener("change", () => readFile(fileInput.files[0]));

  const drop = h(
    "label",
    { class: "dropzone", tabindex: "0" },
    icon("upload"),
    h("div", {}, h("strong", {}, "Upload the client JSON"), h("span", {}, "Drop the client_secret_….json file here, or click to choose it")),
    fileInput,
  );
  drop.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), fileInput.click()));
  drop.addEventListener("dragover", (e) => (e.preventDefault(), drop.classList.add("drag")));
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("drag");
    readFile(e.dataTransfer.files[0]);
  });

  const form = h(
    "form",
    {
      class: "credentials",
      onsubmit: (e) => {
        e.preventDefault();
        save({ clientId: idInput.value, clientSecret: secretInput.value });
      },
    },
    drop,
    h("div", { class: "or" }, "or paste them"),
    h(
      "div",
      { class: "two-col" },
      h("div", { class: "field" }, h("label", { for: "client-id" }, "Client ID"), idInput),
      h("div", { class: "field" }, h("label", { for: "client-secret" }, "Client secret"), secretInput),
    ),
    errorBox,
    h("div", { class: "actions" }, h("button", { class: "btn btn-primary", type: "submit" }, "Save credentials"), state.hasClient && h("button", { class: "btn btn-ghost", type: "button", onclick: () => route("signin") }, "Keep current credentials")),
  );

  const redirect = h("code", {}, state.redirectUri.replace(/:\d+\//, ":<any port>/"));

  fill(panel, 
    head(
      "Step 1 of 3",
      "Create your Google OAuth client",
      "Google only lets apps read Search Console through an OAuth client. You create your own, so the access belongs to you and no one else. This takes about three minutes, once.",
    ),
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "card-body" },
        h(
          "ol",
          { class: "checklist" },
          task("Create a Google Cloud project", "Any name works, for example “Search Console Connector”. Skip this if you already have a project you want to use.", `${CLOUD}/projectcreate`),
          task("Enable the Google Search Console API", "Lets the connector read performance data, inspect URLs and manage sitemaps.", `${CLOUD}/apis/library/searchconsole.googleapis.com`, "Enable"),
          task("Enable the Site Verification API", "Lets Claude Code verify ownership of new sites it builds for you.", `${CLOUD}/apis/library/siteverification.googleapis.com`, "Enable"),
          task(
            "Set up the consent screen",
            "Choose External and add your own email as a test user. Then, under Audience, publish the app to “In production” so your sign-in doesn’t expire every 7 days. You don’t need Google’s app verification for your own use.",
            `${CLOUD}/auth/overview`,
          ),
          task("Create an OAuth client ID", "Choose Application type “Desktop app”, then download the JSON file Google shows you.", `${CLOUD}/auth/clients/create`, "Create"),
        ),
        h("p", { class: "muted note" }, "Desktop clients accept loopback redirects automatically, so there is no redirect URI to configure. This app uses ", redirect, "."),
      ),
    ),
    h("div", { class: "card" }, h("div", { class: "card-body" }, h("h3", {}, "Add your client credentials"), h("p", { class: "muted" }, "Stored only on this computer, in ", h("code", {}, state.configDir), "."), h("div", { class: "spacer-16" }), form)),
  );
}

// ---------- Step 2: Sign in ----------

function signin() {
  const err = params.get("error");
  params.delete("error");
  fill(panel, 
    head("Step 2 of 3", "Sign in with Google", "Use the Google account that has access to your Search Console properties."),
    err ? errorAlert(err) : null,
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "card-body" },
        h("h3", { class: "card-title" }, "The connector will ask Google for permission to:"),
        h(
          "ul",
          { class: "scope-list" },
          h("li", {}, h("span", { class: "scope-icon" }, icon("overview")), h("div", {}, h("strong", {}, "View and manage Search Console data"), h("span", {}, "Performance reports, URL Inspection, sitemaps, and adding properties."))),
          h("li", {}, h("span", { class: "scope-icon" }, icon("check")), h("div", {}, h("strong", {}, "Verify site ownership"), h("span", {}, "Get verification tags for new sites and confirm them with Google."))),
          h("li", {}, h("span", { class: "scope-icon" }, icon("user")), h("div", {}, h("strong", {}, "See your email address"), h("span", {}, "Only to show which account is connected."))),
        ),
        h(
          "div",
          { class: "alert", role: "note" },
          icon("info"),
          h("div", {}, "Google may warn that it “hasn’t verified this app”. The app is your own OAuth client, so choose ", h("strong", {}, "Advanced"), ", then ", h("strong", {}, "Go to (your app name)"), "."),
        ),
        h(
          "div",
          { class: "actions" },
          h("a", { class: "btn btn-google", href: "/auth/start" }, h("span", { html: GOOGLE_G }), "Sign in with Google"),
          h("span", { class: "spacer" }),
          h("button", { class: "btn btn-ghost", type: "button", onclick: () => route("cloud") }, "Use different credentials"),
        ),
      ),
    ),
  );
}

// ---------- Step 3: Property ----------

async function property() {
  fill(panel, 
    head("Step 3 of 3", `Choose the property for ${state.projectName}`, "Claude Code will use this property by default when you work in this project. You can change it later."),
    h("div", { class: "panel-loading" }, h("span", { class: "spinner" }), "Loading your properties"),
  );

  let sites;
  try {
    ({ sites } = await api("/api/sites"));
  } catch (err) {
    fill(panel, head("Step 3 of 3", "Couldn’t load your properties"), errorAlert(err.message), h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => route("property") }, "Try again"), h("button", { class: "btn btn-ghost", onclick: () => route("signin") }, "Sign in again")));
    return;
  }

  const banner = params.get("signedIn") && state.email ? h("div", { class: "alert alert-good" }, icon("check"), h("div", {}, `Signed in as ${state.email}`)) : null;
  params.delete("signedIn");
  const errorBox = h("div", {});

  const finish = async (link) => {
    fill(errorBox, );
    try {
      if (link) {
        await api("/api/project-link", { siteUrl: link });
        state.linkedSite = link;
      }
      await api("/api/finish", {});
      route("done");
    } catch (err) {
      fill(errorBox, errorAlert(err.message));
    }
  };

  if (!sites.length) {
    fill(panel, 
      head("Step 3 of 3", "No properties on this account yet", `${state.email ?? "This account"} doesn’t have any Search Console properties. Claude Code can add and verify this site for you.`),
      banner,
      h(
        "div",
        { class: "card" },
        h("div", { class: "card-body" }, h("p", {}, "Finish here, then ask Claude Code:"), h("div", { class: "copy-row" }, h("code", {}, "Add this site to Google Search Console and verify it")), h("div", { class: "actions" }, h("button", { class: "btn btn-primary", onclick: () => finish() }, "Finish setup"))),
      ),
    );
    return;
  }

  const preselect = state.linkedSite ?? (sites.length === 1 ? sites[0].siteUrl : null);
  const list = h(
    "div",
    { class: "prop-list", role: "radiogroup", "aria-label": "Search Console properties" },
    sites.map((s) =>
      h(
        "label",
        { class: "prop" },
        h("input", { type: "radio", name: "site", value: s.siteUrl, checked: s.siteUrl === preselect }),
        h("img", { src: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(siteLabel(s.siteUrl))}&sz=32`, alt: "", loading: "lazy" }),
        h("span", { class: "prop-main" }, h("strong", {}, siteLabel(s.siteUrl)), h("span", {}, siteKind(s.siteUrl))),
        h("span", { class: `badge ${s.permissionLevel === "siteUnverifiedUser" ? "badge-warn" : s.permissionLevel === "siteOwner" ? "badge-good" : ""}` }, permissionLabel(s.permissionLevel)),
      ),
    ),
  );

  fill(panel, 
    head("Step 3 of 3", `Choose the property for ${state.projectName}`, "Claude Code will use this property by default when you work in this project. You can change it later."),
    banner,
    list,
    errorBox,
    h(
      "div",
      { class: "actions" },
      h(
        "button",
        {
          class: "btn btn-primary btn-lg",
          onclick: () => {
            const picked = list.querySelector("input:checked")?.value;
            if (!picked) return fill(errorBox, errorAlert("Choose a property, or skip this step."));
            finish(picked);
          },
        },
        "Link property and finish",
      ),
      h("button", { class: "btn btn-ghost", onclick: () => finish() }, "Skip for now"),
    ),
  );
}

// ---------- Done ----------

function done() {
  fill(panel, 
    h("div", { class: "done-mark" }, icon("check")),
    head(null, "You’re connected", "Claude Code can now use Search Console in this project. You can close this tab and go back to Claude Code."),
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "card-body" },
        h(
          "dl",
          { class: "summary-list" },
          h("dt", {}, "Google account"),
          h("dd", {}, state.email ?? "Connected"),
          h("dt", {}, "Project"),
          h("dd", {}, state.projectDir),
          h("dt", {}, "Property"),
          h("dd", {}, state.linkedSite ? siteLabel(state.linkedSite) : "Not linked yet"),
        ),
      ),
    ),
    h("div", { class: "actions" }, h("a", { class: "btn btn-primary btn-lg", href: "/dashboard" }, icon("overview"), "Open dashboard")),
  );
}

boot().catch((err) => fill(panel, errorAlert(err.message)));
