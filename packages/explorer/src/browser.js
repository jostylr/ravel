import cytoscape from "cytoscape";
import elk from "cytoscape-elk";
import { EXPLORER_SNAPSHOT_VERSION } from "./index.js";

let elkRegistered = false;

const registerExtensions = () => {
  if (elkRegistered) return;
  cytoscape.use(elk);
  elkRegistered = true;
};

const nodeClasses = (node) => [
  "kind-" + node.kind,
  ...(node.state ?? []).map((state) => "state-" + state)
].join(" ");

const edgeClasses = (edge) => "kind-" + edge.kind;

export const createExplorerElements = (snapshot) => {
  if (snapshot?.version !== EXPLORER_SNAPSHOT_VERSION) {
    throw new TypeError("createExplorerElements requires a version-1 Explorer snapshot.");
  }
  const included = new Set(snapshot.nodes.map(({ id }) => id));
  return [
    ...snapshot.nodes.map((node) => ({
      group: "nodes",
      data: {
        id: node.id,
        label: node.label,
        kind: node.kind,
        ...(node.parent && included.has(node.parent) ? { parent: node.parent } : {}),
        source: node.source,
        explorer: node
      },
      classes: nodeClasses(node)
    })),
    ...snapshot.edges.map((edge) => ({
      group: "edges",
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.count > 1
          ? (edge.label ? edge.label + " ×" + edge.count : edge.kind + " ×" + edge.count)
          : edge.label ?? "",
        kind: edge.kind,
        edgeType: edge.kind,
        explorer: edge
      },
      classes: edgeClasses(edge)
    }))
  ];
};

export const explorerStyles = Object.freeze([
  {
    selector: "node",
    style: {
      "background-color": "#263449",
      "border-color": "#7f8ea3",
      "border-width": 1.5,
      color: "#f5f7fa",
      "font-family": "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      "font-size": 11,
      label: "data(label)",
      padding: 9,
      shape: "round-rectangle",
      "text-halign": "center",
      "text-max-width": 150,
      "text-valign": "center",
      "text-wrap": "wrap",
      width: "label",
      height: "label",
      "min-zoomed-font-size": 6
    }
  },
  {
    selector: "node:parent",
    style: {
      "background-color": "#111827",
      "background-opacity": 0.18,
      "border-color": "#59677c",
      "border-style": "dashed",
      "border-width": 1.5,
      padding: 24,
      "text-halign": "left",
      "text-valign": "top"
    }
  },
  {
    selector: ".kind-document",
    style: {
      "background-color": "#0b1220",
      "border-color": "#6f8098",
      "font-size": 13,
      "font-weight": 600,
      padding: 30
    }
  },
  {
    selector: ".kind-chunk",
    style: {
      "background-color": "#1f4f72",
      "border-color": "#72b7e5"
    }
  },
  {
    selector: ".kind-transform",
    style: {
      "background-color": "#694f19",
      "border-color": "#edc967",
      shape: "diamond",
      width: 54,
      height: 54,
      "text-max-width": 72
    }
  },
  {
    selector: ".kind-compose-step",
    style: {
      "background-color": "#4b3c70",
      "border-color": "#b7a4f4",
      shape: "round-tag"
    }
  },
  {
    selector: ".kind-emit",
    style: {
      "background-color": "#70421f",
      "border-color": "#f0a866",
      shape: "hexagon"
    }
  },
  {
    selector: ".kind-directive",
    style: {
      "background-color": "#3f4552",
      "border-color": "#c0c7d2",
      shape: "rectangle"
    }
  },
  {
    selector: ".kind-deliverable",
    style: {
      "background-color": "#285b43",
      "border-color": "#72d6a5",
      shape: "barrel"
    }
  },
  {
    selector: ".state-live",
    style: {
      "border-color": "#e879f9",
      "border-style": "double",
      "border-width": 4
    }
  },
  {
    selector: ".state-error",
    style: {
      "border-color": "#ff6b6b",
      "border-width": 4
    }
  },
  {
    selector: ".state-warning",
    style: {
      "border-color": "#f6c453",
      "border-width": 3
    }
  },
  {
    selector: "edge",
    style: {
      "curve-style": "taxi",
      "line-color": "#718096",
      "target-arrow-color": "#718096",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.75,
      width: 1.5,
      label: "data(label)",
      color: "#d5dae2",
      "font-family": "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      "font-size": 8,
      "text-background-color": "#111827",
      "text-background-opacity": 0.82,
      "text-background-padding": 2,
      "text-rotation": "autorotate",
      "min-zoomed-font-size": 8
    }
  },
  {
    selector: "edge.kind-contains",
    style: {
      display: "none"
    }
  },
  {
    selector: "edge.kind-references",
    style: {
      "line-color": "#60a5fa",
      "target-arrow-color": "#60a5fa"
    }
  },
  {
    selector: "edge.kind-consumes",
    style: {
      "line-color": "#e879f9",
      "target-arrow-color": "#e879f9",
      "line-style": "dashed"
    }
  },
  {
    selector: "edge.kind-transforms",
    style: {
      "line-color": "#edc967",
      "target-arrow-color": "#edc967"
    }
  },
  {
    selector: "edge.kind-composes",
    style: {
      "line-color": "#b7a4f4",
      "target-arrow-color": "#b7a4f4"
    }
  },
  {
    selector: "edge.kind-emits",
    style: {
      "line-color": "#f0a866",
      "target-arrow-color": "#f0a866"
    }
  },
  {
    selector: "edge.kind-produces",
    style: {
      "line-color": "#72d6a5",
      "target-arrow-color": "#72d6a5",
      width: 2.5
    }
  },
  {
    selector: "edge.kind-imports, edge.kind-aliases",
    style: {
      "line-style": "dotted"
    }
  },
  {
    selector: ":selected",
    style: {
      "overlay-color": "#ffffff",
      "overlay-opacity": 0.12,
      "overlay-padding": 8
    }
  }
]);

export const explorerLayoutOptions = Object.freeze({
  name: "elk",
  nodeDimensionsIncludeLabels: true,
  fit: true,
  padding: 36,
  animate: false,
  elk: {
    algorithm: "layered",
    "elk.direction": "RIGHT",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    "elk.layered.spacing.nodeNodeBetweenLayers": "48",
    "elk.spacing.nodeNode": "36"
  }
});

const runLayout = (cy, options) => {
  if (options === false || cy.nodes().length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    cy.one("layoutstop", resolve);
    cy.layout({ ...explorerLayoutOptions, ...(options ?? {}) }).run();
  });
};

export const createExplorerView = (container, snapshot, options = {}) => {
  if (!container && !options.headless) {
    throw new TypeError("createExplorerView requires a container outside headless mode.");
  }
  registerExtensions();
  const cy = cytoscape({
    container: container ?? undefined,
    headless: Boolean(options.headless),
    style: options.style ?? explorerStyles,
    elements: createExplorerElements(snapshot),
    boxSelectionEnabled: true,
    selectionType: "additive"
  });

  let current = snapshot;
  const selectHandler = (event) => {
    const entity = event.target.data("explorer");
    options.onSelect?.(entity, event);
  };
  cy.on("tap", "node, edge", selectHandler);

  const view = {
    cy,
    get snapshot() {
      return current;
    },
    ready: runLayout(cy, options.layout),
    async update(next, updateOptions = {}) {
      const selected = new Set(cy.$(":selected").map((element) => element.id()));
      current = next;
      cy.batch(() => {
        cy.elements().remove();
        cy.add(createExplorerElements(next));
        for (const id of selected) cy.getElementById(id).select();
      });
      if (updateOptions.layout !== false) {
        await runLayout(cy, updateOptions.layout ?? options.layout);
      }
      return view;
    },
    fit(padding = 36) {
      cy.fit(cy.elements(":visible"), padding);
    },
    select(id) {
      cy.$(":selected").unselect();
      const element = cy.getElementById(id);
      if (element.nonempty()) {
        element.select();
        cy.center(element);
        return element.data("explorer");
      }
      return null;
    },
    destroy() {
      cy.off("tap", "node, edge", selectHandler);
      cy.destroy();
    }
  };
  return view;
};
