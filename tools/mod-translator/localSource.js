async function loadLocalSource(fileList) {
  const files = Array.from(fileList).filter(f => /\.json$/i.test(f.name));
  if (files.length === 0) {
    throw new Error("No .json files found in that folder.");
  }

  const relPaths = files.map(f => f.webkitRelativePath || f.name);
  const roots = findTranslateRoots(relPaths, /* applyB41Filter */ true);
  if (roots.length === 0) {
    throw new Error(
      "No valid Build 42+ Translate/<LANG>/*.json folder found (or the only " +
      "Translate folder found looked like a Build 41 workshop-cache path and was skipped)."
    );
  }
  roots.sort((a, b) => Object.keys(b.languages).length - Object.keys(a.languages).length);

  const fileByPath = new Map();
  files.forEach(f => fileByPath.set(f.webkitRelativePath || f.name, f));

  const folderName = (relPaths[0] || "").split("/")[0] || "Local folder";

  return {
    type: "local",
    label: folderName,
    canWrite: false, // no PR/commit path for a local folder - download only
    mods: roots.map(r => ({ label: guessModLabel(r.translateRoot), translateRoot: r.translateRoot, languages: r.languages })),
    selectedModIndex: 0,

    get translateRoot() { return this.mods[this.selectedModIndex].translateRoot; },
    get languages() { return this.mods[this.selectedModIndex].languages; },

    async readLanguageFiles(langCode) {
      const mod = this.mods[this.selectedModIndex];
      const relPaths = mod.languages[langCode] || [];
      const out = {};
      for (const relPath of relPaths) {
        const fullPath = `${mod.translateRoot}/${relPath}`;
        const withinLangPath = relPath.split("/").slice(1).join("/");
        const file = fileByPath.get(fullPath);
        if (!file) continue;
        try {
          const text = await file.text();
          out[withinLangPath] = JSON.parse(text);
        } catch (e) {
          console.warn(`Skipping ${fullPath}: ${e.message}`);
        }
      }
      return out;
    },
  };
}
