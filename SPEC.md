# MTA for Kindle

This is a web-based app which will be hosted on GitHub Pages and be designed to run in a web browser jailbroken Kindle to display selected MTA train/bus times.

## Capabilities

Select train and busses will be selected in the browser query params. You can also select individual walk times for each station/bus stop.

1. For a given bus stop/train station in the MTA, query the next _N_ trains/busses
2. Display, with an offset, the uptown/downtown/eastward/westward times
3. Design the UI to fit in a standard Kindle layout (keep in mind device size for rendering pixel sizes)
4. Make the UI design modern, and keep in mind that an ereader won't be able to display colors
5. Every minute or so, requery the times to each selected transit so times remain available
6. If there are any bus/subway alerts, display those at the bottom of the page
