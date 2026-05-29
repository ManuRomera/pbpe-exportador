const MODULE_ID = "pbpe-exportador";
const API_NAMESPACE = "api";

const SUPPORTED_TYPES = ["Actor", "Item", "JournalEntry", "RollTable", "Scene"];

const WORLD_COLLECTIONS = {
	Actor: () => game.actors,
	Item: () => game.items,
	JournalEntry: () => game.journal,
	RollTable: () => game.tables,
	Scene: () => game.scenes,
};

const SETTINGS = {
	mode: "defaultMode",
	outputDirectory: "outputDirectory",
	packId: "defaultPackId",
	isPlutoniumOnly: "isPlutoniumOnly",
	useIdAsKey: "useIdAsKey",
	includeMapping: "includeMapping",
	includeFolders: "includeFolders",
};

const DEFAULT_OUTPUT_SLUG = "plutonium-import";

const BABEL_CORE_MAPPINGS = {
	Actor: {
		name: "name",
		description: "system.details.biography.value",
		tokenName: "prototypeToken.name",
	},
	Item: {
		name: "name",
		description: "system.description.value",
	},
	JournalEntry: {
		name: "name",
	},
	RollTable: {
		name: "name",
		description: "description",
	},
	Scene: {
		name: "name",
	},
};

class PBPEExporterMenuStub extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
	static get DEFAULT_OPTIONS () {
		return {
			id: `${MODULE_ID}-menu-stub`,
			classes: ["ve-app"],
			window: {title: "Cargando..."},
			position: {width: 120, height: 120},
		};
	}

	static PARTS = {
		main: {
			template: "templates/generic/form-footer.hbs",
		},
	};

	async render (...args) {
		void args;
		await PBPEModule.pOpenDialog();
		return this;
	}
}

class PBPEModule {
	static init () {
		this._registerSettings();
		this._registerMenu();
		this._registerSettingsUiEnhancements();
	}

	static ready () {
		this._registerApi();
	}

	static onBabeleInit (babele) {
		if (!babele?.registerConverters) return;
		babele.registerConverters(this._getBabeleConverters());
	}

	static _registerSettings () {
		game.settings.register(MODULE_ID, SETTINGS.mode, {
			name: "Modo por defecto",
			hint: "Exportar desde colecciones del mundo o desde un compendio.",
			scope: "world",
			config: true,
			type: String,
			choices: {
				world: "Colecciones del mundo",
				pack: "Compendio individual",
			},
			default: "world",
		});

		game.settings.register(MODULE_ID, SETTINGS.outputDirectory, {
			name: "Directorio de salida",
			hint: "Ruta relativa a Data donde guardar los JSON (ejemplo: modules/mi-modulo-traduccion/compendium/es).",
			scope: "world",
			config: true,
			filePicker: "folder",
			type: String,
			default: "",
		});

		game.settings.register(MODULE_ID, SETTINGS.packId, {
			name: "Pack por defecto",
			hint: "ID de compendio para modo pack (ejemplo: world.mi-pack).",
			scope: "world",
			config: false,
			type: String,
			default: "",
		});

		game.settings.register(MODULE_ID, SETTINGS.isPlutoniumOnly, {
			name: "Solo documentos con flags de Plutonium",
			hint: "Si se activa, exporta solo documentos que tengan flags.plutonium.",
			scope: "world",
			config: true,
			type: Boolean,
			default: true,
		});

		game.settings.register(MODULE_ID, SETTINGS.useIdAsKey, {
			name: "Usar _id como clave",
			hint: "Recomendado para evitar colisiones.",
			scope: "world",
			config: false,
			type: Boolean,
			default: true,
		});

		game.settings.register(MODULE_ID, SETTINGS.includeMapping, {
			name: "Incluir mapping",
			hint: "Incluye la seccion mapping de Babele en el JSON.",
			scope: "world",
			config: false,
			type: Boolean,
			default: true,
		});

		game.settings.register(MODULE_ID, SETTINGS.includeFolders, {
			name: "Incluir carpetas",
			hint: "Incluye traducciones de carpetas en el JSON.",
			scope: "world",
			config: false,
			type: Boolean,
			default: true,
		});
	}

	static _registerMenu () {
		game.settings.registerMenu(MODULE_ID, "openExporter", {
			name: "Exportador post-import para Babele",
			hint: "Abre el asistente de exportacion.",
			label: "Abrir exportador",
			icon: "fas fa-fw fa-language",
			type: PBPEExporterMenuStub,
			restricted: true,
		});
	}

	static _registerSettingsUiEnhancements () {
		Hooks.on("renderSettingsConfig", (_app, html) => {
			const settingName = `${MODULE_ID}.${SETTINGS.outputDirectory}`;
			const $input = html.find(`input[name="${settingName}"]`);
			if (!$input.length) return;

			const $formFields = $input.closest(".form-fields");
			if (!$formFields.length) return;

			// Si Foundry ya ha renderizado su selector de archivos nativo, no duplicar controles.
			if ($formFields.find(".file-picker").length) return;
			if ($formFields.find(".pbpe-settings-browse-output").length) return;

			const $btn = $(`
				<button
					type="button"
					class="pbpe-settings-browse-output"
					title="Explorar carpetas"
					style="height: var(--input-height);"
				>
					<i class="fas fa-folder-open"></i> Explorar...
				</button>
			`);

			$btn.on("click", ev => {
				ev.preventDefault();

				const current = this._normalizeDirectory($input.val() || "modules");
				new FilePicker({
					type: "folder",
					current: current || "modules",
					callback: path => {
						$input.val(this._normalizeDirectory(path));
						$input.trigger("change");
					},
				}).browse();
			});

			$formFields.append($btn);
		});
	}

	static _registerApi () {
		const mod = game.modules.get(MODULE_ID);
		if (!mod) return;

		mod[API_NAMESPACE] = {
			pOpenDialog: this.pOpenDialog.bind(this),
			pExport: this.pExport.bind(this),
			pExportFromWorld: this.pExportFromWorld.bind(this),
			pExportFromPack: this.pExportFromPack.bind(this),
			pWriteDatasetFile: this._pWriteDatasetFile.bind(this),
			getSupportedTypes: () => [...SUPPORTED_TYPES],
		};
	}

	static async pOpenDialog () {
		if (!game.user.isGM) {
			ui.notifications.warn("Solo la direccion de juego (GM) puede exportar.");
			return null;
		}

		const packs = [...game.packs]
			.filter(pack => SUPPORTED_TYPES.includes(pack.metadata.type))
			.sort((a, b) => `${a.metadata.packageName}.${a.metadata.name}`.localeCompare(`${b.metadata.packageName}.${b.metadata.name}`));

		const modeDefault = game.settings.get(MODULE_ID, SETTINGS.mode);
		const outputDirDefault = this._getOutputDirectoryOrDefault(game.settings.get(MODULE_ID, SETTINGS.outputDirectory));
		const packDefaultFromSetting = game.settings.get(MODULE_ID, SETTINGS.packId);
		const packDefault = packs.some(p => p.collection === packDefaultFromSetting)
			? packDefaultFromSetting
			: (packs.find(it => it.collection.startsWith("world."))?.collection || packs[0]?.collection || "");
		const detectedCollectionIds = this._getDetectedCollectionIdsByType({
			outputSlug: DEFAULT_OUTPUT_SLUG,
		});

		const packOptionsHtml = packs
			.map(pack => {
				const id = foundry.utils.escapeHTML(pack.collection);
				const label = foundry.utils.escapeHTML(`${pack.metadata.label} (${pack.collection})`);
				const selected = pack.collection === packDefault ? "selected" : "";
				return `<option value="${id}" ${selected}>${label}</option>`;
			})
			.join("");

		const content = `
		<div class="form-group">
			<label>Modo</label>
			<select name="mode">
				<option value="world" ${modeDefault === "world" ? "selected" : ""}>Colecciones del mundo (recomendado)</option>
				<option value="pack" ${modeDefault === "pack" ? "selected" : ""}>Compendio individual</option>
			</select>
		</div>
		<div class="form-group">
			<label>Compendio (solo modo pack)</label>
			<select name="packId">${packOptionsHtml}</select>
		</div>
		<div class="form-group">
			<label>Directorio de salida (relativo a Data)</label>
			<div class="form-fields">
				<input type="text" name="outputDirectory" value="${foundry.utils.escapeHTML(outputDirDefault)}">
				<button type="button" class="pbpe-btn-browse-output">
					<i class="fas fa-folder-open"></i> Explorar...
				</button>
			</div>
			<p class="notes">Ejemplo: modules/mi-modulo-traduccion/compendium/es</p>
		</div>
		<div class="form-group">
			<label>Solo documentos con flags de Plutonium</label>
			<input type="checkbox" name="isPlutoniumOnly" ${game.settings.get(MODULE_ID, SETTINGS.isPlutoniumOnly) ? "checked" : ""}>
		</div>
		<div class="form-group">
			<label>IDs de coleccion detectados (modo world)</label>
			<div class="form-fields" style="display:block;">
				<div><code>Actor -> ${foundry.utils.escapeHTML(detectedCollectionIds.Actor)}</code></div>
				<div><code>Item -> ${foundry.utils.escapeHTML(detectedCollectionIds.Item)}</code></div>
				<div><code>JournalEntry -> ${foundry.utils.escapeHTML(detectedCollectionIds.JournalEntry)}</code></div>
				<div><code>RollTable -> ${foundry.utils.escapeHTML(detectedCollectionIds.RollTable)}</code></div>
				<div><code>Scene -> ${foundry.utils.escapeHTML(detectedCollectionIds.Scene)}</code></div>
			</div>
			<p class="notes">Se detectan automaticamente para generar nombres compatibles con Babele.</p>
		</div>
		`;

		const formData = await new Promise(resolve => {
			let isResolved = false;
			const doResolve = val => {
				if (isResolved) return;
				isResolved = true;
				resolve(val);
			};

			new Dialog({
				title: "Exportador post-import para Babele",
				content,
				buttons: {
					export: {
						label: "Exportar",
						icon: '<i class="fas fa-file-export"></i>',
						callback: html => doResolve({
							mode: html.find('[name="mode"]').val(),
							packId: html.find('[name="packId"]').val(),
							outputDirectory: html.find('[name="outputDirectory"]').val(),
							isPlutoniumOnly: html.find('[name="isPlutoniumOnly"]').prop("checked"),
						}),
					},
					cancel: {
						label: "Cancelar",
						icon: '<i class="fas fa-times"></i>',
						callback: () => doResolve(null),
					},
				},
				default: "export",
				close: () => doResolve(null),
				render: html => {
					html.find(".pbpe-btn-browse-output").on("click", ev => {
						ev.preventDefault();

						const $input = html.find('[name="outputDirectory"]');
						const current = this._normalizeDirectory($input.val() || outputDirDefault || "modules");

						new FilePicker({
							type: "folder",
							current: current || "modules",
							callback: path => $input.val(this._normalizeDirectory(path)),
						}).browse();
					});
				},
			}).render(true);
		});

		if (!formData) return null;

		const options = {
			mode: formData.mode,
			packId: formData.packId,
			types: [...SUPPORTED_TYPES],
			outputDirectory: formData.outputDirectory,
			outputSlug: DEFAULT_OUTPUT_SLUG,
			collectionIdsByType: detectedCollectionIds,
			folderId: null,
			isPlutoniumOnly: this._toBoolean(formData.isPlutoniumOnly, true),
			useIdAsKey: game.settings.get(MODULE_ID, SETTINGS.useIdAsKey),
			includeMapping: game.settings.get(MODULE_ID, SETTINGS.includeMapping),
			includeFolders: game.settings.get(MODULE_ID, SETTINGS.includeFolders),
		};

		await this._pPersistDefaults(options);
		const result = await this.pExport(options);

		const report = Array.isArray(result.exports)
			? result.exports.map(it => `${it.filename} (${it.count})`).join(", ")
			: `${result.filename} (${result.count})`;
		ui.notifications.info(`Exportacion completada: ${report}`);

		return result;
	}

	static async pExport (opts = {}) {
		const options = this._normalizeOptions(opts);
		if (options.mode === "pack") return this.pExportFromPack(options);
		return this.pExportFromWorld(options);
	}

	static async pExportFromPack (opts = {}) {
		const options = this._normalizeOptions({
			...opts,
			mode: "pack",
		});

		const pack = game.packs.get(options.packId);
		if (!pack) throw new Error(`No se encontro el compendio "${options.packId}".`);
		if (!SUPPORTED_TYPES.includes(pack.metadata.type)) throw new Error(`El tipo de compendio "${pack.metadata.type}" no esta soportado.`);

		const allDocs = await pack.getDocuments();
		const docs = allDocs.filter(doc => !options.isPlutoniumOnly || this._hasPlutoniumFlags(doc));

		const dataset = this._buildDataset({
			type: pack.metadata.type,
			docs,
			includeMapping: options.includeMapping,
			includeFolders: options.includeFolders,
			label: pack.metadata.label,
			source: {
				mode: "pack",
				id: pack.collection,
			},
			useIdAsKey: options.useIdAsKey,
		});

		const filename = `${pack.collection}.json`;
		const outputPath = await this._pWriteDatasetFile({
			dataset,
			filename,
			outputDirectory: options.outputDirectory,
		});

		return {
			mode: "pack",
			packId: pack.collection,
			filename,
			outputPath,
			count: Object.keys(dataset.entries || {}).length,
			dataset,
		};
	}

	static async pExportFromWorld (opts = {}) {
		const options = this._normalizeOptions({
			...opts,
			mode: "world",
		});

		const exports = [];

		for (const type of options.types) {
			const collection = WORLD_COLLECTIONS[type]?.();
			if (!collection) continue;

			const docs = collection.contents.filter(doc => {
				if (options.folderId && doc.folder?.id !== options.folderId) return false;
				if (options.isPlutoniumOnly && !this._hasPlutoniumFlags(doc)) return false;
				return true;
			});

			if (!docs.length) continue;

			const docGroups = this._groupDocsByCollectionId({
				type,
				docs,
				collectionIdsByType: options.collectionIdsByType,
				outputSlug: options.outputSlug,
			});

			if (!docGroups.length) {
				console.warn(`${MODULE_ID} | No se pudo resolver un collectionId valido para ${type}; se omite la exportacion de este tipo.`);
				continue;
			}

			for (const group of docGroups) {
				const dataset = this._buildDataset({
					type,
					docs: group.docs,
					includeMapping: options.includeMapping,
					includeFolders: options.includeFolders,
					label: `${game.world.title}: ${type}`,
					source: {
						mode: "world",
						id: game.world.id,
						folderId: options.folderId,
						collectionId: group.collectionId,
					},
					useIdAsKey: options.useIdAsKey,
				});

				const filename = `${group.collectionId}.json`;
				const outputPath = await this._pWriteDatasetFile({
					dataset,
					filename,
					outputDirectory: options.outputDirectory,
				});

				exports.push({
					type,
					count: Object.keys(dataset.entries || {}).length,
					filename,
					collectionId: group.collectionId,
					outputPath,
					dataset,
				});
			}
		}

		return {
			mode: "world",
			exports,
		};
	}

	static async _pWriteDatasetFile ({dataset, filename, outputDirectory}) {
		const normalizedDir = this._normalizeDirectory(outputDirectory);
		await this._pEnsureDirectory(normalizedDir);

		const data = JSON.stringify(dataset, null, 2);
		const file = new File([data], filename, {type: "application/json"});
		const uploadResult = await FilePicker.upload("data", normalizedDir, file, {}, {notify: false});
		return uploadResult?.path || `${normalizedDir}/${filename}`;
	}

	static async _pEnsureDirectory (targetDir) {
		const normalized = this._normalizeDirectory(targetDir);
		if (!normalized) throw new Error("Falta el directorio de salida.");

		const parts = normalized.split("/").filter(Boolean);
		let current = "";

		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			try {
				await FilePicker.createDirectory("data", current);
			} catch (err) {
				const message = String(err?.message || err || "");
				if (message.includes("EEXIST") || /already exists/i.test(message)) continue;
				// Foundry puede lanzar errores genericos aunque la carpeta ya exista.
				const exists = await this._pDirectoryExists(current);
				if (exists) continue;
				throw err;
			}
		}
	}

	static async _pDirectoryExists (dir) {
		try {
			await FilePicker.browse("data", dir);
			return true;
		} catch (e) {
			void e;
			return false;
		}
	}

	static _normalizeDirectory (dir) {
		return String(dir || "")
			.trim()
			.replace(/^\/+/, "")
			.replace(/\/+$/, "");
	}

	static async _pPersistDefaults (options) {
		await game.settings.set(MODULE_ID, SETTINGS.mode, options.mode);
		await game.settings.set(MODULE_ID, SETTINGS.outputDirectory, this._normalizeDirectory(options.outputDirectory));
		await game.settings.set(MODULE_ID, SETTINGS.packId, options.packId || "");
		await game.settings.set(MODULE_ID, SETTINGS.isPlutoniumOnly, !!options.isPlutoniumOnly);
		await game.settings.set(MODULE_ID, SETTINGS.useIdAsKey, !!options.useIdAsKey);
		await game.settings.set(MODULE_ID, SETTINGS.includeMapping, !!options.includeMapping);
		await game.settings.set(MODULE_ID, SETTINGS.includeFolders, !!options.includeFolders);
	}

	static _normalizeOptions (opts = {}) {
		const mode = opts.mode || game.settings.get(MODULE_ID, SETTINGS.mode) || "world";
		const types = (Array.isArray(opts.types) ? opts.types : [...SUPPORTED_TYPES])
			.map(it => String(it || "").trim())
			.filter(it => SUPPORTED_TYPES.includes(it));

		return {
			mode: mode === "pack" ? "pack" : "world",
			packId: opts.packId || game.settings.get(MODULE_ID, SETTINGS.packId) || "",
			types: types.length ? types : [...SUPPORTED_TYPES],
			outputDirectory: this._getOutputDirectoryOrDefault(opts.outputDirectory || game.settings.get(MODULE_ID, SETTINGS.outputDirectory)),
			outputSlug: this._toSlug(opts.outputSlug || DEFAULT_OUTPUT_SLUG),
			collectionIdsByType: this._sanitizeCollectionIdsByType(opts.collectionIdsByType || {}),
			folderId: opts.folderId || null,
			isPlutoniumOnly: this._toBoolean(opts.isPlutoniumOnly, game.settings.get(MODULE_ID, SETTINGS.isPlutoniumOnly)),
			useIdAsKey: this._toBoolean(opts.useIdAsKey, game.settings.get(MODULE_ID, SETTINGS.useIdAsKey)),
			includeMapping: this._toBoolean(opts.includeMapping, game.settings.get(MODULE_ID, SETTINGS.includeMapping)),
			includeFolders: this._toBoolean(opts.includeFolders, game.settings.get(MODULE_ID, SETTINGS.includeFolders)),
		};
	}

	static _buildDataset (
		{
			type,
			docs,
			includeMapping,
			includeFolders,
			label,
			source,
			useIdAsKey,
		},
	) {
		const dataset = {
			label: label || type,
			mapping: {},
			folders: {},
			entries: {},
			_meta: {
				generatedBy: MODULE_ID,
				generatedAt: new Date().toISOString(),
				source,
				type,
				entryCount: 0,
			},
		};

		const mapping = includeMapping
			? foundry.utils.deepClone(BABEL_CORE_MAPPINGS[type] || {name: "name"})
			: {};

		for (const doc of docs) {
			const raw = foundry.utils.deepClone(doc.toObject());
			const data = this._extractByType(type, raw);
			if (!data || !Object.keys(data).length) continue;

			const key = this._getEntryKey({
				raw,
				existingEntries: dataset.entries,
				data,
				useIdAsKey,
			});
			dataset.entries[key] = data;

			if (includeFolders) this._addFoldersForDoc(dataset.folders, doc);
		}

		if (includeMapping) {
			this._addAdvancedMappingForType(type, mapping, dataset.entries);
			dataset.mapping = mapping;
		} else {
			delete dataset.mapping;
		}

		if (!includeFolders || !Object.keys(dataset.folders).length) delete dataset.folders;
		dataset._meta.entryCount = Object.keys(dataset.entries).length;

		return dataset;
	}

	static _extractByType (type, raw) {
		switch (type) {
			case "Item": return this._extractItem(raw);
			case "Actor": return this._extractActor(raw);
			case "JournalEntry": return this._extractJournalEntry(raw);
			case "RollTable": return this._extractRollTable(raw);
			case "Scene": return this._extractScene(raw);
			default: return null;
		}
	}

	static _extractItem (item) {
		const out = {};
		if (item.name) out.name = item.name;

		const description = foundry.utils.getProperty(item, "system.description.value");
		if (description) out.description = description;

		const activitiesOut = this._extractActivities(foundry.utils.getProperty(item, "system.activities"));
		if (Object.keys(activitiesOut).length) out.activities = activitiesOut;

		const effectsOut = this._extractEffects(item.effects);
		if (Object.keys(effectsOut).length) out.effects = effectsOut;

		const advancementOut = this._extractAdvancement(foundry.utils.getProperty(item, "system.advancement"));
		if (Object.keys(advancementOut).length) out.advancement = advancementOut;

		return out;
	}

	static _extractActor (actor) {
		const out = {};
		if (actor.name) out.name = actor.name;

		const tokenName = foundry.utils.getProperty(actor, "prototypeToken.name");
		if (tokenName && tokenName.toLowerCase() !== (actor.name || "").toLowerCase()) out.tokenName = tokenName;

		const description = foundry.utils.getProperty(actor, "system.details.biography.value");
		if (description) out.description = description;

		if (Array.isArray(actor.items) && actor.items.length) {
			const itemsOut = {};
			for (const item of actor.items) {
				if (item?._tombstone) continue;
				const itemData = this._extractItem(item);
				if (!Object.keys(itemData).length) continue;
				const key = this._getUniqueObjectKey(itemsOut, item._id, item.name, itemData);
				itemsOut[key] = itemData;
			}
			if (Object.keys(itemsOut).length) out.items = itemsOut;
		}

		const effectsOut = this._extractEffects(actor.effects);
		if (Object.keys(effectsOut).length) out.effects = effectsOut;

		return out;
	}

	static _extractJournalEntry (journalEntry) {
		const out = {};
		if (journalEntry.name) out.name = journalEntry.name;

		if (Array.isArray(journalEntry.pages) && journalEntry.pages.length) {
			const pagesOut = {};
			for (const page of journalEntry.pages) {
				const pageOut = {};
				if (page.name) pageOut.name = page.name;

				const caption = foundry.utils.getProperty(page, "image.caption");
				if (caption) pageOut.caption = caption;
				if (page.src) pageOut.src = page.src;

				const text = foundry.utils.getProperty(page, "text.content");
				if (text) pageOut.text = text;

				const width = foundry.utils.getProperty(page, "video.width");
				if (width != null) pageOut.width = width;
				const height = foundry.utils.getProperty(page, "video.height");
				if (height != null) pageOut.height = height;

				const tooltip = foundry.utils.getProperty(page, "system.tooltip");
				if (tooltip) pageOut.tooltip = tooltip;
				const subclassHeader = foundry.utils.getProperty(page, "system.subclassHeader");
				if (subclassHeader) pageOut.subclassHeader = subclassHeader;

				const pageDescription = foundry.utils.getProperty(page, "system.description.value");
				if (pageDescription) pageOut.description = pageDescription;

				const additionalEquipment = foundry.utils.getProperty(page, "system.description.additionalEquipment");
				if (additionalEquipment) pageOut.additionalEquipment = additionalEquipment;
				const additionalHitPoints = foundry.utils.getProperty(page, "system.description.additionalHitPoints");
				if (additionalHitPoints) pageOut.additionalHitPoints = additionalHitPoints;
				const additionalTraits = foundry.utils.getProperty(page, "system.description.additionalTraits");
				if (additionalTraits) pageOut.additionalTraits = additionalTraits;
				const subclass = foundry.utils.getProperty(page, "system.description.subclass");
				if (subclass) pageOut.subclass = subclass;

				const flagsTitle = foundry.utils.getProperty(page, "flags.dnd5e.title");
				if (flagsTitle) pageOut.flagsTitle = flagsTitle;

				const unlinkedSpells = foundry.utils.getProperty(page, "system.unlinkedSpells");
				if (unlinkedSpells && typeof unlinkedSpells === "object" && Object.keys(unlinkedSpells).length) {
					pageOut.unlinkedSpells = Object.fromEntries(
						Object.entries(unlinkedSpells)
							.map(([, spellValue]) => [spellValue?.name || "", {name: spellValue?.name || ""}])
							.filter(([name]) => !!name),
					);
				}

				if (!Object.keys(pageOut).length) continue;
				const key = this._getUniqueObjectKey(pagesOut, page._id, page.name, pageOut);
				pagesOut[key] = pageOut;
			}

			if (Object.keys(pagesOut).length) out.pages = pagesOut;
		}

		return out;
	}

	static _extractRollTable (table) {
		const out = {};
		if (table.name) out.name = table.name;
		if (table.description) out.description = table.description;

		if (Array.isArray(table.results) && table.results.length) {
			const rangeCount = new Map();
			for (const result of table.results) {
				const rangeStr = this._getRangeStr(result.range);
				rangeCount.set(rangeStr, (rangeCount.get(rangeStr) || 0) + 1);
			}

			const resultsOut = {};
			for (const result of table.results) {
				const rangeStr = this._getRangeStr(result.range);
				const isDuplicateRange = (rangeCount.get(rangeStr) || 0) > 1;
				const key = isDuplicateRange ? result._id : rangeStr;

				const resultOut = {};
				if (result.name) resultOut.name = result.name;
				if (result.description) resultOut.description = result.description;
				if (result.text && !resultOut.description) resultOut.description = result.text;
				if (Array.isArray(result.range) && result.range.length >= 2) resultOut.range = {"0": result.range[0], "1": result.range[1]};

				if (!Object.keys(resultOut).length) continue;
				resultsOut[key] = (Object.keys(resultOut).length === 1 && resultOut.description)
					? resultOut.description
					: resultOut;
			}

			if (Object.keys(resultsOut).length) out.results = resultsOut;
		}

		return out;
	}

	static _extractScene (scene) {
		const out = {};
		if (scene.name) out.name = scene.name;
		if (scene.navName) out.navName = scene.navName;

		if (Array.isArray(scene.drawings) && scene.drawings.length) {
			const drawingsOut = {};
			for (const drawing of scene.drawings) {
				if (!drawing.text) continue;
				drawingsOut[drawing.text] = drawing.text;
			}
			if (Object.keys(drawingsOut).length) out.drawings = drawingsOut;
		}

		if (Array.isArray(scene.notes) && scene.notes.length) {
			const notesOut = {};
			for (const note of scene.notes) {
				if (!note.text) continue;
				notesOut[note.text] = note.text;
			}
			if (Object.keys(notesOut).length) out.notes = notesOut;
		}

		if (Array.isArray(scene.tokens) && scene.tokens.length) {
			const deltaTokensOut = {};
			for (const token of scene.tokens) {
				const deltaActor = token.delta || {};
				const deltaActorData = this._extractActor(deltaActor);
				if (token.name && (!deltaActorData.name || deltaActorData.name !== token.name)) deltaActorData.name = token.name;
				if (!Object.keys(deltaActorData).length) continue;
				const key = this._getUniqueObjectKey(deltaTokensOut, token._id, token.name, deltaActorData);
				deltaTokensOut[key] = deltaActorData;
			}
			if (Object.keys(deltaTokensOut).length) out.deltaTokens = deltaTokensOut;
		}

		if (Array.isArray(scene.regions) && scene.regions.length) {
			const regionsOut = {};
			for (const region of scene.regions) {
				const regionOut = {};
				if (region.name) regionOut.name = region.name;

				if (Array.isArray(region.behaviors) && region.behaviors.length) {
					const behaviorsOut = {};
					for (const behavior of region.behaviors) {
						const behaviorOut = {};
						if (behavior.name) behaviorOut.name = behavior.name;
						const behaviorText = foundry.utils.getProperty(behavior, "system.text");
						if (behaviorText) behaviorOut.text = behaviorText;
						if (!Object.keys(behaviorOut).length) continue;
						const behaviorKey = this._getUniqueObjectKey(behaviorsOut, behavior._id, behavior.name, behaviorOut);
						behaviorsOut[behaviorKey] = behaviorOut;
					}
					if (Object.keys(behaviorsOut).length) regionOut.behaviors = behaviorsOut;
				}

				if (!Object.keys(regionOut).length) continue;
				const key = this._getUniqueObjectKey(regionsOut, region._id, region.name, regionOut);
				regionsOut[key] = regionOut;
			}
			if (Object.keys(regionsOut).length) out.regions = regionsOut;
		}

		return out;
	}

	static _extractActivities (activities) {
		const out = {};
		if (!activities || typeof activities !== "object") return out;

		for (const [activityKey, activity] of Object.entries(activities)) {
			if (!activity || typeof activity !== "object") continue;

			const activityOut = {};
			if (activity.name) activityOut.name = activity.name;
			if (activity.roll?.name) activityOut.roll = activity.roll.name;
			if (activity.activation?.condition) activityOut.condition = activity.activation.condition;
			if (activity.description?.chatFlavor) activityOut.chatFlavor = activity.description.chatFlavor;
			if (activity.duration?.special) activityOut.duration = activity.duration.special;
			if (activity.range?.special) activityOut.range = activity.range.special;
			if (activity.target?.affects?.special) activityOut.target = activity.target.affects.special;

			if (Array.isArray(activity.profiles) && activity.profiles.length) {
				const profiles = {};
				for (const profile of activity.profiles) {
					if (!profile?.name) continue;
					profiles[profile.name] = {name: profile.name};
				}
				if (Object.keys(profiles).length) activityOut.profiles = profiles;
			}

			if (!Object.keys(activityOut).length) continue;
			const preferredKey = activity.name || activity.type || activityKey;
			const key = this._getUniqueObjectKey(out, activity._id || activityKey, preferredKey, activityOut);
			out[key] = activityOut;
		}

		return out;
	}

	static _extractEffects (effects) {
		const out = {};
		if (!Array.isArray(effects) || !effects.length) return out;

		for (const effect of effects) {
			if (!effect || effect._tombstone) continue;

			const effectOut = {};
			if (effect.name) effectOut.name = effect.name;
			if (effect.description) effectOut.description = effect.description;

			if (Array.isArray(effect.changes) && effect.changes.length) {
				const changes = {};
				for (const change of effect.changes) {
					if (!this._isPotentiallyTranslatableEffectChange(change)) continue;
					changes[change.key] = change.value;
				}
				if (Object.keys(changes).length) effectOut.changes = changes;
			}

			if (!Object.keys(effectOut).length) continue;
			const key = this._getUniqueObjectKey(out, effect._id, effect.name, effectOut);
			out[key] = effectOut;
		}

		return out;
	}

	static _extractAdvancement (advancement) {
		const out = {};
		if (!Array.isArray(advancement) || !advancement.length) return out;

		for (const adv of advancement) {
			if (!adv) continue;
			const advOut = {};
			if (adv.title) advOut.title = adv.title;
			if (adv.hint) advOut.hint = adv.hint;
			if (!Object.keys(advOut).length) continue;
			const key = this._getUniqueObjectKey(out, adv._id, adv.title, advOut);
			out[key] = advOut;
		}

		return out;
	}

	static _isPotentiallyTranslatableEffectChange (change) {
		if (!change || !change.key || typeof change.value !== "string" || !change.value.length) return false;
		if (change.key === "name") return true;
		if (change.key.includes("description")) return true;
		if (change.key.endsWith(".label")) return true;
		if (change.key.endsWith(".condition")) return true;
		if (change.key.endsWith(".chatFlavor")) return true;
		if (change.key.endsWith(".special")) return true;
		if (change.key.endsWith(".roll.name")) return true;
		return /"(condition|special|name|description)"/i.test(change.value);
	}

	static _addAdvancedMappingForType (type, mapping, entries) {
		const values = Object.values(entries || {});
		if (!values.length) return;

		switch (type) {
			case "Item": {
				if (values.some(entry => entry.activities)) mapping.activities = {path: "system.activities", converter: "pbpeActivities"};
				if (values.some(entry => entry.effects)) mapping.effects = {path: "effects", converter: "pbpeEffects"};
				if (values.some(entry => entry.advancement)) mapping.advancement = {path: "system.advancement", converter: "pbpeAdvancement"};
				break;
			}

			case "Actor": {
				if (values.some(entry => entry.items)) mapping.items = {path: "items", converter: "pbpeActorItems"};
				if (values.some(entry => entry.effects)) mapping.effects = {path: "effects", converter: "pbpeEffects"};
				break;
			}

			case "JournalEntry": {
				if (values.some(entry => entry.pages)) mapping.pages = {path: "pages", converter: "pbpePages"};
				break;
			}

			case "RollTable": {
				if (values.some(entry => entry.results)) mapping.results = {path: "results", converter: "pbpeTableResults"};
				break;
			}

			case "Scene": {
				if (values.some(entry => entry.drawings)) mapping.drawings = {path: "drawings", converter: "textCollection"};
				if (values.some(entry => entry.notes)) mapping.notes = {path: "notes", converter: "textCollection"};
				if (values.some(entry => entry.deltaTokens)) mapping.deltaTokens = {path: "tokens", converter: "pbpeDeltaTokens"};
				if (values.some(entry => entry.regions)) mapping.regions = {path: "regions", converter: "pbpeRegions"};
				if (values.some(entry => entry.navName)) mapping.navName = "navName";
				break;
			}
		}
	}

	static _getBabeleConverters () {
		return {
			pbpeActivities: (activities, translations) => this._converterActivities(activities, translations),
			pbpeEffects: (effects, translations) => this._converterEffects(effects, translations),
			pbpeAdvancement: (advancement, translations) => this._converterAdvancement(advancement, translations),
			pbpeActorItems: (items, translations) => this._converterActorItems(items, translations),
			pbpePages: (pages, translations) => this._converterPages(pages, translations),
			pbpeTableResults: (results, translations) => this._converterTableResults(results, translations),
			pbpeDeltaTokens: (tokens, translations) => this._converterDeltaTokens(tokens, translations),
			pbpeRegions: (regions, translations) => this._converterRegions(regions, translations),
		};
	}

	static _converterActivities (activities, translations) {
		if (!activities || !translations) return activities;
		const out = foundry.utils.deepClone(activities);

		for (const [activityKey, activity] of Object.entries(out)) {
			const translation = this._getTranslationByCandidates(translations, [activity._id, activity.name, activityKey]);
			if (!translation) continue;

			if (typeof translation === "string") {
				activity.name = translation;
				continue;
			}

			if (translation.name != null) activity.name = translation.name;
			if (translation.roll != null) foundry.utils.setProperty(activity, "roll.name", translation.roll);
			if (translation.condition != null) foundry.utils.setProperty(activity, "activation.condition", translation.condition);
			if (translation.chatFlavor != null) foundry.utils.setProperty(activity, "description.chatFlavor", translation.chatFlavor);
			if (translation.duration != null) foundry.utils.setProperty(activity, "duration.special", translation.duration);
			if (translation.range != null) foundry.utils.setProperty(activity, "range.special", translation.range);
			if (translation.target != null) foundry.utils.setProperty(activity, "target.affects.special", translation.target);

			if (translation.profiles && Array.isArray(activity.profiles)) {
				for (const profile of activity.profiles) {
					const profileTranslation = this._getTranslationByCandidates(translation.profiles, [profile._id, profile.name]);
					if (!profileTranslation) continue;
					if (typeof profileTranslation === "string") profile.name = profileTranslation;
					else if (profileTranslation.name != null) profile.name = profileTranslation.name;
				}
			}
		}

		return out;
	}

	static _converterEffects (effects, translations) {
		if (!Array.isArray(effects) || !translations) return effects;
		const out = foundry.utils.deepClone(effects);

		for (const effect of out) {
			const translation = this._getTranslationByCandidates(translations, [effect._id, effect.name]);
			if (!translation) continue;

			if (typeof translation === "string") {
				effect.name = translation;
				continue;
			}

			if (translation.name != null) effect.name = translation.name;
			if (translation.description != null) effect.description = translation.description;

			if (translation.changes && Array.isArray(effect.changes)) {
				for (const change of effect.changes) {
					if (!Object.hasOwn(translation.changes, change.key)) continue;
					change.value = translation.changes[change.key];
				}
			}
		}

		return out;
	}

	static _converterAdvancement (advancement, translations) {
		if (!Array.isArray(advancement) || !translations) return advancement;
		const out = foundry.utils.deepClone(advancement);

		for (const adv of out) {
			const translation = this._getTranslationByCandidates(translations, [adv._id, adv.title]);
			if (!translation || typeof translation === "string") continue;
			if (translation.title != null) adv.title = translation.title;
			if (translation.hint != null) adv.hint = translation.hint;
		}

		return out;
	}

	static _converterActorItems (items, translations) {
		if (!Array.isArray(items) || !translations) return items;
		const out = foundry.utils.deepClone(items);

		for (const item of out) {
			const translation = this._getTranslationByCandidates(translations, [item._id, item.name]);
			if (!translation) continue;
			this._applyItemTranslation(item, translation);
		}

		return out;
	}

	static _converterPages (pages, translations) {
		if (!Array.isArray(pages) || !translations) return pages;
		const out = foundry.utils.deepClone(pages);

		for (const page of out) {
			const translation = this._getTranslationByCandidates(translations, [page._id, page.name]);
			if (!translation) continue;

			if (typeof translation === "string") {
				page.name = translation;
				continue;
			}

			if (translation.name != null) page.name = translation.name;
			if (translation.caption != null) foundry.utils.setProperty(page, "image.caption", translation.caption);
			if (translation.src != null) page.src = translation.src;
			if (translation.text != null) foundry.utils.setProperty(page, "text.content", translation.text);
			if (translation.width != null) foundry.utils.setProperty(page, "video.width", translation.width);
			if (translation.height != null) foundry.utils.setProperty(page, "video.height", translation.height);
			if (translation.tooltip != null) foundry.utils.setProperty(page, "system.tooltip", translation.tooltip);
			if (translation.subclassHeader != null) foundry.utils.setProperty(page, "system.subclassHeader", translation.subclassHeader);
			if (translation.description != null) foundry.utils.setProperty(page, "system.description.value", translation.description);
			if (translation.additionalEquipment != null) foundry.utils.setProperty(page, "system.description.additionalEquipment", translation.additionalEquipment);
			if (translation.additionalHitPoints != null) foundry.utils.setProperty(page, "system.description.additionalHitPoints", translation.additionalHitPoints);
			if (translation.additionalTraits != null) foundry.utils.setProperty(page, "system.description.additionalTraits", translation.additionalTraits);
			if (translation.subclass != null) foundry.utils.setProperty(page, "system.description.subclass", translation.subclass);
			if (translation.flagsTitle != null) foundry.utils.setProperty(page, "flags.dnd5e.title", translation.flagsTitle);
		}

		return out;
	}

	static _converterTableResults (results, translations) {
		if (!Array.isArray(results) || !translations) return results;
		const out = foundry.utils.deepClone(results);

		for (const result of out) {
			const rangeKey = this._getRangeStr(result.range);
			const translation = this._getTranslationByCandidates(translations, [result._id, rangeKey, result.name]);
			if (!translation) continue;

			if (typeof translation === "string") {
				if (Object.hasOwn(result, "description")) result.description = translation;
				else if (Object.hasOwn(result, "text")) result.text = translation;
				continue;
			}

			if (translation.name != null) result.name = translation.name;
			if (translation.description != null) {
				if (Object.hasOwn(result, "description")) result.description = translation.description;
				else if (Object.hasOwn(result, "text")) result.text = translation.description;
			}

			if (translation.range && (translation.range["0"] != null || translation.range["1"] != null)) {
				result.range = [
					translation.range["0"] ?? result.range?.[0],
					translation.range["1"] ?? result.range?.[1],
				];
			}
		}

		return out;
	}

	static _converterDeltaTokens (tokens, translations) {
		if (!Array.isArray(tokens) || !translations) return tokens;
		const out = foundry.utils.deepClone(tokens);

		for (const token of out) {
			const translation = this._getTranslationByCandidates(translations, [token._id, token.name]);
			if (!translation || typeof translation !== "object") continue;
			if (translation.name != null) token.name = translation.name;
			if (token.delta) this._applyActorTranslation(token.delta, translation);
		}

		return out;
	}

	static _converterRegions (regions, translations) {
		if (!Array.isArray(regions) || !translations) return regions;
		const out = foundry.utils.deepClone(regions);

		for (const region of out) {
			const translation = this._getTranslationByCandidates(translations, [region._id, region.name]);
			if (!translation || typeof translation !== "object") continue;
			if (translation.name != null) region.name = translation.name;

			if (translation.behaviors && Array.isArray(region.behaviors)) {
				for (const behavior of region.behaviors) {
					const behaviorTranslation = this._getTranslationByCandidates(translation.behaviors, [behavior._id, behavior.name]);
					if (!behaviorTranslation) continue;
					if (typeof behaviorTranslation === "string") {
						behavior.name = behaviorTranslation;
						continue;
					}
					if (behaviorTranslation.name != null) behavior.name = behaviorTranslation.name;
					if (behaviorTranslation.text != null) foundry.utils.setProperty(behavior, "system.text", behaviorTranslation.text);
				}
			}
		}

		return out;
	}

	static _applyActorTranslation (actor, translation) {
		if (!actor || typeof actor !== "object" || !translation || typeof translation !== "object") return actor;
		if (translation.name != null) actor.name = translation.name;
		if (translation.tokenName != null) foundry.utils.setProperty(actor, "prototypeToken.name", translation.tokenName);
		if (translation.description != null) foundry.utils.setProperty(actor, "system.details.biography.value", translation.description);
		if (translation.items && Array.isArray(actor.items)) actor.items = this._converterActorItems(actor.items, translation.items);
		if (translation.effects && Array.isArray(actor.effects)) actor.effects = this._converterEffects(actor.effects, translation.effects);
		return actor;
	}

	static _applyItemTranslation (item, translation) {
		if (!item || typeof item !== "object" || !translation) return item;
		if (typeof translation === "string") {
			item.name = translation;
			return item;
		}

		if (translation.name != null) item.name = translation.name;
		if (translation.description != null) foundry.utils.setProperty(item, "system.description.value", translation.description);
		if (translation.activities) {
			const activities = foundry.utils.getProperty(item, "system.activities");
			foundry.utils.setProperty(item, "system.activities", this._converterActivities(activities, translation.activities));
		}
		if (translation.effects && Array.isArray(item.effects)) item.effects = this._converterEffects(item.effects, translation.effects);
		if (translation.advancement) {
			const advancement = foundry.utils.getProperty(item, "system.advancement");
			foundry.utils.setProperty(item, "system.advancement", this._converterAdvancement(advancement, translation.advancement));
		}

		return item;
	}

	static _getEntryKey ({raw, existingEntries, data, useIdAsKey}) {
		const preferred = useIdAsKey ? raw._id : raw.name;
		if (!existingEntries[preferred]) return preferred;
		if (foundry.utils.objectsEqual(existingEntries[preferred], data)) return preferred;
		return raw._id || raw.name;
	}

	static _getUniqueObjectKey (obj, id, name, data) {
		const preferred = name && name.length ? name : id;
		if (!obj[preferred]) return preferred;
		if (foundry.utils.objectsEqual(obj[preferred], data)) return preferred;
		return id || `${preferred}-${Object.keys(obj).length + 1}`;
	}

	static _addFoldersForDoc (foldersOut, doc) {
		let folder = doc.folder || null;
		while (folder) {
			foldersOut[folder.name] = foldersOut[folder.name] || folder.name;
			folder = folder.folder || null;
		}
	}

	static _hasPlutoniumFlags (doc) {
		const flags = foundry.utils.getProperty(doc, "flags.plutonium");
		return !!(flags && typeof flags === "object" && Object.keys(flags).length);
	}

	static _getTranslationByCandidates (translations, candidates) {
		if (!translations || !candidates?.length) return null;

		for (const candidate of candidates) {
			if (candidate == null || candidate === "") continue;

			if (Array.isArray(translations)) {
				const found = translations.find(it => it?.id === candidate || it?.name === candidate);
				if (found) return found;
				continue;
			}

			if (Object.hasOwn(translations, candidate)) return translations[candidate];
		}

		return null;
	}

	static _getRangeStr (range) {
		if (!Array.isArray(range) || range.length < 2) return "";
		return `${range[0]}-${range[1]}`;
	}

	static _getOutputDirectoryOrDefault (rawValue) {
		const clean = this._normalizeDirectory(rawValue);
		if (clean) return clean;

		const suggested = this._normalizeDirectory(this._getSuggestedBabeleOutputDirectory());
		if (suggested) return suggested;

		return `modules/${MODULE_ID}/exports`;
	}

	static _getSuggestedBabeleOutputDirectory () {
		const lang = game.i18n?.lang || "es";
		const babeleModules = game.babele?.modules || [];
		if (!babeleModules.length) return "";

		const activeCandidates = babeleModules
			.filter(meta => meta?.module && meta?.dir)
			.filter(meta => !meta.lang || meta.lang === lang)
			.filter(meta => meta.module !== "babele" && meta.module !== MODULE_ID)
			.filter(meta => game.modules.get(meta.module)?.active);

		const fallbackCandidates = babeleModules
			.filter(meta => meta?.module && meta?.dir)
			.filter(meta => !meta.lang || meta.lang === lang)
			.filter(meta => meta.module !== "babele" && meta.module !== MODULE_ID);

		const picked = activeCandidates[0] || fallbackCandidates[0];
		if (!picked) return "";

		return `modules/${picked.module}/${picked.dir}`;
	}

	static _sanitizeCollectionIdsByType (collectionIdsByType = {}) {
		const out = {};
		for (const type of SUPPORTED_TYPES) {
			out[type] = this._normalizeCollectionId(collectionIdsByType[type], {isAllowEmpty: true});
		}
		return out;
	}

	static _getDetectedCollectionIdsByType ({outputSlug = DEFAULT_OUTPUT_SLUG} = {}) {
		const out = {};
		for (const type of SUPPORTED_TYPES) {
			out[type] = this._getResolvedCollectionIdForType({
				type,
				collectionIdsByType: {},
				outputSlug,
			}) || "";
		}
		return out;
	}

	static _getResolvedCollectionIdForType ({type, docs = [], collectionIdsByType = {}, outputSlug = DEFAULT_OUTPUT_SLUG}) {
		const manual = this._normalizeCollectionId(collectionIdsByType[type], {isAllowEmpty: true});
		if (manual) return manual;

		const inferredFromDocs = this._inferCollectionIdFromDocs(docs);
		if (inferredFromDocs) return inferredFromDocs;

		const packsOfType = this._getPacksByType(type);
		if (packsOfType.length === 1) return packsOfType[0].collection;

		const worldPacks = packsOfType.filter(pack => pack.collection.startsWith("world."));
		if (worldPacks.length === 1) return worldPacks[0].collection;
		if (worldPacks.length > 1) {
			const likelyWorldPack = this._getLikelyPackByTypeName({type, packs: worldPacks});
			if (likelyWorldPack) return likelyWorldPack.collection;
			return worldPacks[0].collection;
		}

		if (packsOfType.length > 1) {
			const likelyPack = this._getLikelyPackByTypeName({type, packs: packsOfType});
			if (likelyPack) return likelyPack.collection;
			return packsOfType[0].collection;
		}

		// Si no hay compendios de referencia, devolvemos null para evitar generar nombres
		// de archivo que Babele no pueda asociar a ningun pack real.
		void outputSlug;
		return null;
	}

	static _groupDocsByCollectionId ({type, docs = [], collectionIdsByType = {}, outputSlug = DEFAULT_OUTPUT_SLUG}) {
		if (!Array.isArray(docs) || !docs.length) return [];

		const manual = this._normalizeCollectionId(collectionIdsByType[type], {isAllowEmpty: true});
		if (manual) return [{collectionId: manual, docs: [...docs]}];

		const grouped = new Map();
		const unresolved = [];

		for (const doc of docs) {
			const sourceId = this._getDocSourceId(doc);
			const collectionId = this._getCollectionIdFromSourceId(sourceId);
			if (!collectionId) {
				unresolved.push(doc);
				continue;
			}

			if (!grouped.has(collectionId)) grouped.set(collectionId, []);
			grouped.get(collectionId).push(doc);
		}

		if (unresolved.length) {
			const fallbackCollectionId = this._getResolvedCollectionIdForType({
				type,
				docs: unresolved,
				collectionIdsByType: {},
				outputSlug,
			});

			if (fallbackCollectionId) {
				if (!grouped.has(fallbackCollectionId)) grouped.set(fallbackCollectionId, []);
				grouped.get(fallbackCollectionId).push(...unresolved);
			}
		}

		return [...grouped.entries()].map(([collectionId, groupedDocs]) => ({collectionId, docs: groupedDocs}));
	}

	static _inferCollectionIdFromDocs (docs = []) {
		if (!Array.isArray(docs) || !docs.length) return "";

		const counts = new Map();
		for (const doc of docs) {
			const sourceId = this._getDocSourceId(doc);
			const collectionId = this._getCollectionIdFromSourceId(sourceId);
			if (!collectionId) continue;
			counts.set(collectionId, (counts.get(collectionId) || 0) + 1);
		}

		if (!counts.size) return "";

		let bestId = "";
		let bestCount = -1;
		let isTie = false;
		for (const [collectionId, count] of counts.entries()) {
			if (count > bestCount) {
				bestId = collectionId;
				bestCount = count;
				isTie = false;
				continue;
			}
			if (count === bestCount) isTie = true;
		}

		if (!isTie) return bestId;

		const worldCandidates = [...counts.keys()].filter(it => it.startsWith("world."));
		if (worldCandidates.length === 1) return worldCandidates[0];

		return bestId;
	}

	static _getDocSourceId (doc) {
		if (!doc) return "";

		const raw = doc.toObject ? doc.toObject() : doc;
		return String(
			foundry.utils.getProperty(raw, "flags.core.sourceId")
			|| foundry.utils.getProperty(raw, "_stats.compendiumSource")
			|| "",
		).trim();
	}

	static _getCollectionIdFromSourceId (sourceId) {
		if (!sourceId) return "";

		try {
			const parsed = foundry.utils.parseUuid?.(sourceId);
			if (parsed?.collection) return this._normalizeCollectionId(parsed.collection, {isAllowEmpty: true});
		} catch (e) {
			void e;
		}

		const clean = sourceId.trim();
		const match = clean.match(/^Compendium\.([^.]+\.[^.]+)\./i);
		if (match?.[1]) return this._normalizeCollectionId(match[1], {isAllowEmpty: true});

		return "";
	}

	static _getPacksByType (type) {
		return [...game.packs]
			.filter(pack => pack.metadata?.type === type)
			.sort((a, b) => `${a.metadata.packageName}.${a.metadata.name}`.localeCompare(`${b.metadata.packageName}.${b.metadata.name}`));
	}

	static _getLikelyPackByTypeName ({type, packs}) {
		const hints = this._getTypeNameHints(type);
		if (!hints.length) return null;

		const matches = packs.filter(pack => {
			const haystack = `${pack.metadata?.name || ""} ${pack.metadata?.label || ""}`.toLowerCase();
			return hints.some(hint => haystack.includes(hint));
		});

		if (matches.length === 1) return matches[0];
		return null;
	}

	static _getTypeNameHints (type) {
		switch (type) {
			case "Actor": return ["actor", "actors", "npc", "monster", "creature", "criatura", "criaturas"];
			case "Item": return ["item", "items", "spell", "spells", "equipment", "loot", "objeto", "objetos"];
			case "JournalEntry": return ["journal", "journals", "diario", "diarios"];
			case "RollTable": return ["rolltable", "table", "tables", "tabla", "tablas"];
			case "Scene": return ["scene", "scenes", "escena", "escenas"];
			default: return [];
		}
	}

	static _normalizeCollectionId (collectionId, {fallback = "", isAllowEmpty = false} = {}) {
		let clean = String(collectionId || "")
			.trim()
			.replace(/\.json$/i, "");

		if (!clean) {
			if (isAllowEmpty) return "";
			clean = fallback;
		}

		if (!clean) return "";

		if (!clean.includes(".")) clean = `world.${clean}`;
		return clean;
	}

	static _toSlug (value) {
		return String(value || "")
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			|| DEFAULT_OUTPUT_SLUG;
	}

	static _toBoolean (value, fallback = false) {
		if (value == null) return fallback;
		if (typeof value === "boolean") return value;
		if (typeof value === "string") return ["true", "1", "on", "yes"].includes(value.trim().toLowerCase());
		if (typeof value === "number") return value !== 0;
		return fallback;
	}
}

Hooks.once("init", () => PBPEModule.init());
Hooks.once("ready", () => PBPEModule.ready());
Hooks.once("babele.init", babele => PBPEModule.onBabeleInit(babele));
