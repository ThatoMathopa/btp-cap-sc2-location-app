sap.ui.define([
  'sap/ui/core/mvc/Controller',
  'sap/ui/model/json/JSONModel',
  'sap/m/MessageBox',
  'sap/m/MessageToast',
  'sap/ui/core/Item'
], (Controller, JSONModel, MessageBox, MessageToast, Item) => {
  'use strict';

  const SC2_BASE_URL = 'https://my1001219.de1.test.crm.cloud.sap';

  return Controller.extend('com.company.locationmashup.controller.LocationMashup', {

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    onInit() {
      // Results model — bound to the table
      this.getView().setModel(new JSONModel({ results: [], busy: false }), 'results');

      // State model — caseId, status, selected location
      this.getView().setModel(new JSONModel({
        caseId          : '',
        statusMessage   : '',
        statusState     : 'None',
        selectedLocation: null
      }), 'state');

      // Read Case ID from URL — SC2 passes ?caseId=XXXXX when embedding mashup
      const sCaseId = this._getUrlParam('caseId') || '';
      this._getStateModel().setProperty('/caseId', sCaseId);

      // Load all locations on startup
      this._search();
    },

    // ── Search ────────────────────────────────────────────────────────────────

    onLiveSearch() { this._search(); },
    onReset() {
      this.byId('globalSearch').setValue('');
      this.byId('filterWard').setSelectedKey('');
      this.byId('filterRegion').setSelectedKey('');
      this._search();
      MessageToast.show(this._i18n('filtersCleared'));
    },

    // Assign a consistent highlight colour per region so rows are visually grouped
    _regionHighlight(sRegion) {
      const map = {};
      const palette = ['Information', 'Success', 'Warning', 'Error'];
      return (sRegion) => {
        if (!sRegion) return 'None';
        if (!map[sRegion]) {
          const keys = Object.keys(map);
          map[sRegion] = palette[keys.length % palette.length];
        }
        return map[sRegion];
      };
    },

    async _search() {
      const query  = (this.byId('globalSearch').getValue() || '').trim();
      const ward   = this.byId('filterWard').getSelectedKey()   || '';
      const region = this.byId('filterRegion').getSelectedKey() || '';

      const oResultsModel = this.getView().getModel('results');
      oResultsModel.setProperty('/busy', true);

      try {
        const oModel  = this.getView().getModel();
        const oAction = oModel.bindContext('/searchLocations(...)');
        oAction.setParameter('query',  query);
        oAction.setParameter('ward',   ward);
        oAction.setParameter('region', region);

        await oAction.execute();

        const oResult = oAction.getBoundContext().getObject();
        let   aData   = oResult?.value || (Array.isArray(oResult) ? oResult : []);

        // Enrich each row with computed display fields
        const highlightFor = this._regionHighlight();
        aData = aData.map(r => ({
          ...r,
          _fullName  : r.Extension ? `${r.LocationName} (${r.Extension})` : r.LocationName,
          _highlight : highlightFor(r.Region)
        }));

        oResultsModel.setProperty('/results', aData);
        this._setResultCount(this._i18n('resultCount', [aData.length]));

        // Populate Ward/Region dropdowns from first full load
        if (!query && !ward && !region) {
          this._populateDropdowns(aData);
        }

      } catch (e) {
        console.error('Search failed:', e);
        this._setResultCount(this._i18n('loadingText'));
      } finally {
        oResultsModel.setProperty('/busy', false);
      }
    },

    // ── Row press ─────────────────────────────────────────────────────────────

    onRowPress(oEvent) {
      const oCtx = oEvent.getSource().getBindingContext('results');
      this._getStateModel().setProperty('/selectedLocation', oCtx.getObject());
    },

    // ── "Use Location" button ─────────────────────────────────────────────────

    onUseLocation(oEvent) {
      oEvent.stopPropagation?.();

      const oCtx      = oEvent.getSource().getParent().getBindingContext('results');
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
          { duration: 2000 }
        );

        // Redirect back to SC2 case after successful update
        // Use window.top so the redirect escapes the SC2 iframe
        var redirectCaseId = sCaseId;
        setTimeout(function() {
          try {
            window.top.location.href = SC2_BASE_URL + "/ui#Case-Display&/Cases('" + redirectCaseId + "')";
          } catch (_) {
            // Fallback if top is cross-origin sandboxed
            window.location.href = SC2_BASE_URL + "/ui#Case-Display&/Cases('" + redirectCaseId + "')";
          }
        }, 2000);

      } catch (e) {
        const sMsg = e?.error?.message || e?.message || this._i18n('updateError');
        this._setStatus(this._i18n('updateErrorDetail', [sMsg]), 'Error');
        MessageBox.error(sMsg, { title: this._i18n('updateErrorTitle') });
      } finally {
        this.getView().setBusy(false);
      }
    },

    // ── Refresh ───────────────────────────────────────────────────────────────

    onSync() {
      this._search();
      MessageToast.show(this._i18n('syncSuccess'));
    },

    // ── Status ────────────────────────────────────────────────────────────────

    onClearStatus() { this._setStatus('', 'None'); },

    _setStatus(sText, sState) {
      this._getStateModel().setProperty('/statusMessage', sText);
      this._getStateModel().setProperty('/statusState',   sState);
    },

    // ── Dropdowns from loaded data ────────────────────────────────────────────

    _populateDropdowns(aData) {
      const oWardSel = this.byId('filterWard');
      const oRegSel  = this.byId('filterRegion');

      const clearKeepFirst = (oSel) => {
        while (oSel.getItems().length > 1) oSel.removeItem(1);
      };
      clearKeepFirst(oWardSel);
      clearKeepFirst(oRegSel);

      const wards   = [...new Set(aData.map(r => r.Ward).filter(Boolean))].sort();
      const regions = [...new Set(aData.map(r => r.Region).filter(Boolean))].sort();

      wards.forEach(w   => oWardSel.addItem(new Item({ key: w, text: w })));
      regions.forEach(r => oRegSel.addItem(new Item({ key: r, text: r })));
    },

    // ── Helpers ───────────────────────────────────────────────────────────────

    _getStateModel() { return this.getView().getModel('state'); },
    _setResultCount(sText) { this.byId('resultCount').setText(sText); },

    _i18n(sKey, aArgs) {
      return this.getOwnerComponent()
        .getModel('i18n').getResourceBundle().getText(sKey, aArgs);
    },

    _getUrlParam(sName) {
      return new URL(window.location.href).searchParams.get(sName) || '';
    }

  });
});
