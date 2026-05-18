# Betty — things still to wire up

## 1. Download links

The download buttons on the hero currently point to `#` and fall back to the releases page.
To make them work:

- Decide if the Betty app lives in the same repo (`bethaniel_webpage`) or a separate one
- Open `index.html` and find the `<script>` block near the bottom
- Replace `YOUR_GITHUB_USERNAME` and `YOUR_APP_REPO` with the real values
- Make sure releases are published on GitHub with assets named exactly:
  - `Betty-{tag}-arm64.dmg` (macOS)
  - `Betty-{tag}-x64.exe` (Windows)
  - `Betty-{tag}-x86_64.AppImage` (Linux)
- Also update the GitHub link in the footer of both `index.html` and `blog.html`

---

## 2. Contact form (for companies)

Uses Formspree — free tier, no backend needed, forwards to simon@journeycatcher.com.

Steps:

1. Go to [formspree.io](https://formspree.io) and create a free account
2. Create a new form — set the destination email to `simon@journeycatcher.com`
3. Copy the form ID from the action URL (looks like `xpwzabcd`)
4. In `index.html`, find `YOUR_FORMSPREE_ID` and replace it with your ID

---

## 3. Mailing list

Uses Buttondown — free up to 100 subscribers, no card required.

Steps:

1. Go to [buttondown.email](https://buttondown.email) and create a free account
2. Your chosen username becomes part of the form action URL
3. In `index.html`, find `YOUR_BUTTONDOWN_USERNAME` and replace it with your username

---

## 4. Donation button

Uses Ko-fi — free to sign up, they take a small cut per donation only (no monthly fee).

Steps:

1. Go to [ko-fi.com](https://ko-fi.com) and create a free account
2. Your username appears in your Ko-fi URL (e.g. `ko-fi.com/betty`)
3. Replace `YOUR_KOFI` in **three places**:
   - Nav donate button in `index.html`
   - Donation section in `index.html`
   - Nav donate button in `blog.html`

---

## 5. Disclosure text

The disclosure `<details>` section on `index.html` contains placeholder copy.
Review and replace it with your actual terms — what Betty can and can't do,
any liability notes, data handling confirmation, etc.

---

## 6. Open Graph image

`index.html` references `Public/logo-icon.svg` as the OG image, which won't render
well when the page is shared on social media (it expects a raster image).

- Create a `1200 × 630 px` PNG (e.g. in Figma or Canva — warm parchment bg, full logo centred)
- Save it as `Public/og-image.png`
- Update the `<meta property="og:image">` tag in `index.html` to point to it
- Add the same tag to `blog.html`

---

## 7. Vercel deployment

The site is ready to deploy as a static site — no config file needed.

Steps:

1. Push the repo to GitHub (if not already there)
2. Go to [vercel.com](https://vercel.com), import the repo
3. Framework preset: **Other** (plain static)
4. Root directory: `/` (the repo root)
5. Deploy — done

Optional: add a custom domain in the Vercel dashboard after first deploy.

---

## Summary

| #   | Item            | Service           | Effort                                        |
| --- | --------------- | ----------------- | --------------------------------------------- |
| 1   | Download links  | GitHub Releases   | Fill in 2 placeholders + upload release files |
| 2   | Contact form    | Formspree (free)  | 5 min signup, 1 placeholder                   |
| 3   | Mailing list    | Buttondown (free) | 5 min signup, 1 placeholder                   |
| 4   | Donation button | Ko-fi (free)      | 5 min signup, 3 placeholders                  |
| 5   | Disclosure text | —                 | Write your own copy                           |
| 6   | OG image        | —                 | Design 1200×630 PNG                           |
| 7   | Vercel deploy   | Vercel (free)     | Import repo, click deploy                     |
