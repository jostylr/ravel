// Stand-ins for package-owned transforms. Core receives these as capabilities;
// it neither imports nor knows the implementation of either language.
export const pugLike = (value) => "<html><body>" + value.match(/\|\s*(\S+)/)?.[1] + "</body></html>";

export const markdownLike = (value) => "<h1>" + value.slice(2).trim() + "</h1>";
