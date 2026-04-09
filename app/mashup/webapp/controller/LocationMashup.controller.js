sap.ui.define([
  'sap/ui/core/mvc/Controller',
  'sap/ui/model/Filter',
  'sap/ui/model/FilterOperator',
  'sap/m/MessageBox',
  'sap/m/MessageToast',
  'sap/ui/core/Item'
], (Controller, Filter, FilterOperator, MessageBox, MessageToast, Item) => {
  'use strict';

  return Controller.extend('com.company.locationmashup.controller.LocationMashup', {

    // ── Lifecycle ────────────────────────────────────────────────────────────

    onInit() {
      this._oRouter = this.getOwnerComponent().getRouter();

      // Read Case ID from URL query parameter ?caseId=XXXXX
      // Service Cloud V2 passes context via URL when embedding a mashup.
      const sCaseId = this._getUrlParam('caseId') || '';
      this._getStateModel().setProperty('/caseId', sCaseId);

      // Populate Ward & Region dropdowns after model is ready
      this.getView().getModel().attachMetadataLoaded(
        this._populateDropdowns.bind(this));
    },

    // ── Data events ──────────────────────────────────────────────────────────

    onDataRequested() {
      this.byId('tableBusy').setVisible(true);
      this._setResultCount(this._i18n('loadingText'));
    },

    onDataReceived(oEvent) {
      this.byId('tableBusy').setVisible(false);
      if (oEvent.getParameter('error')) return;
      const oBinding = this._getTableBinding();
      const count    = oBinding ? oBinding.getLength() : 0;
      this._setResultCount(this._i18n('resultCount', [count]));
    },

    // ── Search / Filter ───────────────────────────────────────────────────────

    onLiveSearch() {
      this._applyFilters();
    },

    onReset() {
      this.byId('globalSearch').setValue('');
      this.byId('filterName').setValue('');
      this.byId('filterWard').setSelectedKey('');
      this.byId('filterRegion').setSelectedKey('');
      this._applyFilters();
      MessageToast.show(this._i18n('filtersCleared'));
    },

    _applyFilters() {
      const aFilters = [];

      // Global free-text search across all fields
      const sGlobal = (this.byId('globalSearch').getValue() || '').trim();
      if (sGlobal) {
        aFilters.push(new Filter({
          filters: [
            new Filter('LocationName', FilterOperator.Contains, sGlobal),
            new Filter('Ward',         FilterOperator.Contains, sGlobal),
            new Filter('Region',       FilterOperator.Contains, sGlobal),
            new Filter('Extension',    FilterOperator.Contains, sGlobal)
          ],
          and: false
        }));
      }

      // Location Name field
      const sName = (this.byId('filterName').getValue() || '').trim();
      if (sName) {
        aFilters.push(new Filter('LocationName', FilterOperator.Contains, sName));
      }

      // Ward dropdown
      const sWard = this.byId('filterWard').getSelectedKey();
      if (sWard) {
        aFilters.push(new Filter('Ward', FilterOperator.EQ, sWard));
      }

      // Region dropdown
      const sRegion = this.byId('filterRegion').getSelectedKey();
      if (sRegion) {
        aFilters.push(new Filter('Region', FilterOperator.EQ, sRegion));
      }

      const oFinal = aFilters.length
        ? new Filter({ filters: aFilters, and: true })
        : null;

      this._getTableBinding().filter(oFinal ? [oFinal] : []);
    },

    // ── Row press ────────────────────────────────────────────────────────────

    onRowPress(oEvent) {
      const oCtx = oEvent.getSource().getBindingContext();
      this._getStateModel().setProperty('/selectedLocation', oCtx.getObject());
    },

    // ── "Use Location" button ─────────────────────────────────────────────────

    onUseLocation(oEvent) {
      oEvent.stopPropagation?.();

      const oCtx      = oEvent.getSource().getParent().getBindingContext();
      const oLocation = oCtx.getObject();
      const sCaseId   = this._getStateModel().getProperty('/caseId');

      if (!sCaseId) {
        MessageBox.warning(this._i18n('noCaseWarning'));
        return;
      }

      const sDisplayName = oLocation.LocationName +
        (oLocation.Extension ? ` (${oLocation.Extension})` : '');

      MessageBox.confirm(
        this._i18n('confirmUpdate', [sDisplayName, sCaseId]),
        {
          title:   this._i18n('confirmTitle'),
          onClose: (sAction) => {
            if (sAction === MessageBox.Action.OK) {
              this._callUpdateAction(
                sCaseId,
                oLocation.LocationName,
                oLocation.Ward,
                oLocation.Region,
                oLocation.Extension
              );
            }
          }
        }
      );
    },

    // ── CAP Action: updateCaseLocation ────────────────────────────────────────

    async _callUpdateAction(sCaseId, sLocationName, sWard, sRegion, sExtension) {
      this._setStatus('', 'None');
      this.getView().setBusy(true);

      try {
        const oModel  = this.getView().getModel();
        const oAction = oModel.bindContext('/updateCaseLocation(...)');
        oAction.setParameter('caseId',       sCaseId);
        oAction.setParameter('locationName', sLocationName);
        oAction.setParameter('ward',         sWard      || '');
        oAction.setParameter('region',       sRegion    || '');
        oAction.setParameter('extension',    sExtension || '');

        await oAction.execute();

        const oResult      = oAction.getBoundContext().getObject();
        const sDisplayName = sLocationName + (sExtension ? ` (${sExtension})` : '');
        this._setStatus(
          oResult?.message || this._i18n('updateSuccess', [sDisplayName, sCaseId]),
          'Success'
        );
        MessageToast.show(
          this._i18n('updateSuccess', [sDisplayName, sCaseId]),
          { duration: 4000 }
        );

      } catch (oError) {
        const sMsg = oError?.error?.message
          || oError?.message
          || this._i18n('updateError');
        this._setStatus(this._i18n('updateErrorDetail', [sMsg]), 'Error');
        MessageBox.error(sMsg, { title: this._i18n('updateErrorTitle') });
      } finally {
        this.getView().setBusy(false);
      }
    },

    // ── Refresh (replaces syncFromS4 — data is always live from S4) ──────────

    onSync() {
      this.getView().setBusy(true);
      this._getTableBinding().refresh();
      this._populateDropdowns();
      this.getView().setBusy(false);
      MessageToast.show(this._i18n('syncSuccess'));
    },

    // ── Status strip ──────────────────────────────────────────────────────────

    onClearStatus() {
      this._setStatus('', 'None');
    },

    _setStatus(sText, sState) {
      const oState = this._getStateModel();
      oState.setProperty('/statusMessage', sText);
      oState.setProperty('/statusState',   sState);
    },

    // ── Populate Ward / Region dropdowns ─────────────────────────────────────

    _populateDropdowns() {
      const oModel   = this.getView().getModel();
      const oWardSel = this.byId('filterWard');
      const oRegSel  = this.byId('filterRegion');

      const clearKeepFirst = (oSel) => {
        while (oSel.getItems().length > 1) oSel.removeItem(1);
      };

      // OData V4: use bindList + requestContexts
      oModel.bindList('/Locations', null, null, null, { $select: 'Ward' })
        .requestContexts(0, 500).then(aCtx => {
          clearKeepFirst(oWardSel);
          const seen = new Set();
          aCtx.forEach(oCtx => {
            const w = oCtx.getProperty('Ward');
            if (w && !seen.has(w)) {
              seen.add(w);
              oWardSel.addItem(new Item({ key: w, text: w }));
            }
          });
        });

      oModel.bindList('/Locations', null, null, null, { $select: 'Region' })
        .requestContexts(0, 500).then(aCtx => {
          clearKeepFirst(oRegSel);
          const seen = new Set();
          aCtx.forEach(oCtx => {
            const r = oCtx.getProperty('Region');
            if (r && !seen.has(r)) {
              seen.add(r);
              oRegSel.addItem(new Item({ key: r, text: r }));
            }
          });
        });
    },

    // ── Helpers ──────────────────────────────────────────────────────────────

    _getTableBinding() {
      return this.byId('locationsTable').getBinding('items');
    },

    _getStateModel() {
      return this.getView().getModel('state');
    },

    _setResultCount(sText) {
      this.byId('resultCount').setText(sText);
    },

    _i18n(sKey, aArgs) {
      return this.getOwnerComponent()
        .getModel('i18n')
        .getResourceBundle()
        .getText(sKey, aArgs);
    },

    _getUrlParam(sName) {
      const url = new URL(window.location.href);
      return url.searchParams.get(sName) || '';
    }

  });
});
