# A small site built with Ravel

This document holds the parts every page shares. The pages themselves are
plain Markdown files under `pages/`, collected by `[[collections]]` in
`ravel.toml`.

## Layout

Each page's front matter fills the placeholders; `content` is the page body
after the collection's `pipe` (here, Markdown rendering and smart quotes).

```html {.ravel #layout}
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{{ title | html }} · Example site</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<nav><a href="/index.html">Home</a></nav>
<main>
<h1>{{ title | html }}</h1>
{{ content }}
</main>
</body>
</html>
```

## Home page

`pages::index.json` lists every page's front matter, slug, and output path in
order, so the home page can link to them without any code.

```html {.ravel #home-template}
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Example site</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<main>
<h1>Example site</h1>
<ul>
{{#each pages}}<li><a href="/{{ out }}">{{ title | html }}</a> — {{ summary | html }}</li>
{{/each}}</ul>
</main>
</body>
</html>
```

```html {.ravel #home}
_"home-template.html | template('pages', ch('pages::index.json'))"
```

## Style

```css {.ravel #style}
body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
nav { margin-bottom: 1rem; }
```

```ravel
out("index.html", _"home.html")
out("style.css", _"style.css")
```
