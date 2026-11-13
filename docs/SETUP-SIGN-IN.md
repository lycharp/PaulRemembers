# Setting up sign-in, sync and sharing

The journal keeps working without any of this. These steps give it a free
online home (Supabase) so you can sign in, see your entries on every device,
and share entries or whole journals. It takes about 10 minutes, plus about 10
more if you want "Sign in with Google".

## Part 1: Create the free Supabase project (required)

1. Go to **https://supabase.com** and click **Start your project**.
   Choose **Continue with GitHub** and sign in with your GitHub account.
2. If it asks you to create an organization, name it anything (for example
   "Paul"), pick the **Free** plan, and click **Create organization**.
3. Click **New project** and fill in:
   - **Project name:** `PaulRemembers`
   - **Database password:** click **Generate a password**, then copy it into
     your password manager. You will probably never need it, but keep it.
   - **Region:** the one closest to you (for example *East US*).
   - Click **Create new project**, then wait a minute or two until it says
     the project is ready.
4. In the left sidebar click **SQL Editor** (the `>_` icon), then **New query**.
5. Open this file in another tab:
   https://github.com/lycharp/PaulRemembers/blob/main/supabase/setup.sql
   (until the change is merged, use the `claude/project-thread-yyraas` branch:
   https://github.com/lycharp/PaulRemembers/blob/claude/project-thread-yyraas/supabase/setup.sql).
   Click the **Copy raw file** button (two overlapping squares, top right of the file).
6. Paste it into the Supabase SQL editor and click **Run**. It should say
   *Success. No rows returned*. (If it shows a warning about "destructive
   operations", click **Run this query** — it only replaces its own rules.)
7. In the left sidebar click **Authentication**, then **URL Configuration**:
   - **Site URL:** `https://lycharp.github.io/PaulRemembers/` → **Save**
   - Under **Redirect URLs** click **Add URL**, enter
     `https://lycharp.github.io/PaulRemembers/**` → **Save URLs**.
8. In the left sidebar click **Project Settings** (gear icon) → **Data API**
   (or **API**). Copy the **Project URL** (looks like
   `https://abcdxyz.supabase.co`). Then go to **API Keys** and copy the
   **anon public** key (or the **publishable** key, which starts with
   `sb_publishable_`).
9. Send both to Claude in the project thread. These two values are designed
   to be public (they are visible to anyone who opens the website), so it is
   safe to paste them in chat. **Do not** send the database password or the
   `service_role` / secret key.

That is enough for email + password sign-in.

## Part 2: "Sign in with Google" (optional)

1. Go to **https://console.cloud.google.com** and sign in with your Google account.
   Accept the terms if asked.
2. At the top, click the project picker → **New project**, name it
   `PaulRemembers`, click **Create**, then make sure it is selected.
3. In the search bar type **Google Auth Platform** and open it. Click
   **Get started**:
   - **App name:** `Journal`, **User support email:** your email → **Next**
   - **Audience:** **External** → **Next**
   - **Contact information:** your email → **Next** → tick the agreement → **Create**.
4. Click **Audience** in the left menu, then **Publish app** → **Confirm**
   (otherwise only "test users" can sign in).
5. Click **Clients** in the left menu → **Create client**:
   - **Application type:** *Web application*, **Name:** `Journal`
   - **Authorized JavaScript origins** → **Add URI** → `https://lycharp.github.io`
   - **Authorized redirect URIs** → **Add URI** → paste the **Callback URL**
     from Supabase (in Supabase: **Authentication** → **Sign In / Providers**
     → **Google**; it looks like `https://abcdxyz.supabase.co/auth/v1/callback`).
   - Click **Create**. Copy the **Client ID** and **Client secret** shown.
6. Back in Supabase (**Authentication** → **Sign In / Providers** → **Google**):
   turn on **Enable Sign in with Google**, paste the Client ID and Client
   secret, and click **Save**.

The Google button in the app works as soon as this is saved.

## Part 3: Make sign-up invite-only (required)

Only people you invite can create an account. Supabase enforces this, so it
works even if someone skips the app.

1. In Supabase, click **SQL Editor** → **New query**.
2. Open https://github.com/lycharp/PaulRemembers/blob/main/supabase/setup.sql,
   click **Copy raw file**, paste it in, and click **Run** (click **Run this
   query** if it warns about "destructive operations").
3. Click **New query** again, paste this line with the email address you sign
   in to the app with, and click **Run**:

   ```sql
   select make_admin('you@example.com');
   ```

   It should say *Done: … can now invite people*. This makes you the only
   person who can invite, and invites everyone you already share a journal with.
4. Leave **Authentication** → **Sign In / Providers** → **Allow new users to
   sign up** turned on. Invited people need it; everyone else is refused.

In the app, **Settings → Invite someone** (only you see it) lists who can sign
up. Sharing a journal with someone adds them there too.

## Good to know

- The free plan includes 1 GB of photo/video storage and 500 MB of text,
  which is plenty for thousands of entries. Supabase pauses free projects
  after a week with no use at all; if that happens, log in to supabase.com
  and click **Restore**. Your data is kept.
- New accounts must confirm their email address (Supabase sends the email).
- Sharing a journal with someone: they create an account using the same
  email address you shared it with (the link in the invite email opens
  **Create an account**), and the journal appears for them. Only the admin's
  shares count as invites; anyone else can only share with people who already
  have an account or were invited.
