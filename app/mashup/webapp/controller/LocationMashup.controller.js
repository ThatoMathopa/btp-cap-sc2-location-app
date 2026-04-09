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

      // After initial data load, populate Ward & Region dropdowns
      this.getView().getModel().attachEventOnce('requestCompleted',
        this._populateDropdowns.bind(this));
    },

    // ── Data events ──────────────────────────────────────────────────────────

    onDataRequested() {
      this.byId('tableBusy').setVisible(true);
      this._setResultCount(this._i18n('loadingText'));
    },

    onDataReceived(oEvent) {
      this.byId('tableBusy').setVisible(false);
      const data  = oEvent.getParameter('data');
      const count = data?.value?.length ?? 0;
      this._setResultCount(this._i18n('resultCount', [count]));
    },

    // ── Search / Filter (live — fires on every keystroke / selection) ─────────

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

      // 1. Global search — OR across all text fields
      const sGlobal = (this.byId('globalSearch').getValue() || '').trim();
      if (sGlobal) {
        aFilters.push(new Filter({
          filters: [
            new Filter('fullLocationName', FilterOperator.Contains, sGlobal),
            new Filter('locationName',     FilterOperator.Contains, sGlobal),
            new Filter('ward',             FilterOperator.Contains, sGlobal),
            new Filter('region',           FilterOperator.Contains, sGlobal),
            new Filter('extension',        FilterOperator.Contains, sGlobal)
          ],
          and: false
        }));
      }

      // 2. Location Name field
      const sName = (this.byId('filterName').getValue() || '').trim();
      if (sName) {
        aFilters.push(new Filter('locationName', FilterOperator.Contains, sName));
      }

      // 3. Ward dropdown
      const sWard = this.byId('filterWard').getSelectedKey();
      if (sWard) {
        aFilters.push(new Filter('ward', FilterOperator.EQ, sWard));
      }

      // 4. Region dropdown
      const sRegion = this.byId('filterRegion').getSelectedKey();
      if (sRegion) {
        aFilters.push(new Filter('region', FilterOperator.EQ, sRegion));
      }

      const oFinal = aFilters.length
        ? new Filter({ filters: aFilters, and: true })
        : null;

      this._getTableBinding().filter(oFinal ? [oFinal] : []);
    },

    // ── Row press (highlight row) ────────────────────────────────────────────

    onRowPress(oEvent) {
      const oCtx = oEvent.getSource().getBindingContext();
      this._getStateModel().setProperty('/selectedLocation', oCtx.getObject());
    },

    // ── "Use Location" button — writes extension fields to SC2 case ──────────

    onUseLocation(oEvent) {
      // Stop the row-press event from also firing
      oEvent.stopPropagation?.();

      const oCtx      = oEvent.getSource().getParent().getBindingContext();
      const oLocation = oCtx.getObject();
      const sCaseId   = this._getStateModel().getProperty('/caseId');

      if (!sCaseId) {
        MessageBox.warning(this._i18n('noCaseWarning'));
        return;
      }

      // Confirm before writing
      MessageBox.confirm(
        this._i18n('confirmUpdate', [oLocation.fullLocationName, sCaseId]),
        {
          title:   this._i18n('confirmTitle'),
          onClose: (sAction) => {
            if (sAction === MessageBox.Action.OK) {
              this._callUpdateAction(sCaseId, oLocation.ID, oLocation.fullLocationName);
            }
          }
        }
      );
    },

    // ── CAP Action: updateCaseLocation ──────────────────────────────────────

    async _callUpdateAction(sCaseId, sLocationId, sFullName) {
      this._setStatus('', 'None');
      this.getView().setBusy(true);

      try {
        // OData V4 unbound action call
        const oModel  = this.getView().getModel();
        const oAction = oModel.bindContext('/updateCaseLocation(...)');
        oAction.setParameter('caseId',     sCaseId);
        oAction.setParameter('locationId', sLocationId);

        await oAction.execute();

        const oResult = oAction.getBoundContext().getObject();
        this._setStatus(
          oResult?.message || this._i18n('updateSuccess', [sFullName, sCaseId]),
          'Success'
        );
        MessageToast.show(this._i18n('updateSuccess', [sFullName, sCaseId]), { duration: 4000 });

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

    // ── S/4HANA Sync ─────────────────────────────────────────────────────────

    onSync() {
      MessageBox.confirm(this._i18n('syncConfirm'), {
        title: this._i18n('syncTitle'),
        onClose: async (sAction) => {
          if (sAction !== MessageBox.Action.OK) return;

          this.getView().setBusy(true);
          try {
            const oModel  = this.getView().getModel();
            const oAction = oModel.bindContext('/syncFromS4(...)');
            await oAction.execute();
            const sResult = oAction.getBoundContext().getObject()?.value
              || this._i18n('syncSuccess');
            MessageToast.show(sResult, { duration: 4000 });
            this._getTableBinding().refresh();
            this._populateDropdowns();
          } catch (oErr) {
            MessageBox.error(oErr?.error?.message || this._i18n('syncError'));
          } finally {
            this.getView().setBusy(false);
          }
        }
      });
    },

    // ── Status strip ─────────────────────────────────────────────────────────

    onClearStatus() {
      this._setStatus('', 'None');
    },

    _setStatus(sText, sState) {
      const oState = this._getStateModel();
      oState.setProperty('/statusMessage', sText);
      oState.setProperty('/statusState',   sState);
    },

    // ── Populate Ward / Region dropdowns from live data ──────────────────────

    _populateDropdowns() {
      const oModel    = this.getView().getModel();
      const oWardSel  = this.byId('filterWard');
      const oRegSel   = this.byId('filterRegion');

      // Remove all items except the first "All" item
      const clearKeepFirst = (oSel) => {
        while (oSel.getItems().length > 1) oSel.removeItem(1);
      };

      // Read distinct Wards
      oModel.read('/Locations', {
        urlParameters: { $select: 'ward', $orderby: 'ward asc' },
        success: ({ results }) => {
          clearKeepFirst(oWardSel);
          const seen = new Set();
          (results || []).forEach(({ ward }) => {
            if (ward && !seen.has(ward)) {
              seen.add(ward);
              oWardSel.addItem(new Item({ key: ward, text: ward }));
            }
          });
        }
      });

      // Read distinct Regions
      oModel.read('/Locations', {
        urlParameters: { $select: 'region', $orderby: 'region asc' },
        success: ({ results }) => {
          clearKeepFirst(oRegSel);
          const seen = new Set();
          (results || []).forEach(({ region }) => {
            if (region && !seen.has(region)) {
              seen.add(region);
              oRegSel.addItem(new Item({ key: region, text: region }));
            }
          });
        }
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

    /**
     * Read a URL query parameter — used to get caseId passed by Service Cloud V2
     * when this mashup is embedded as an iFrame / mashup component.
     *
     * SC2 can pass parameters via URL like:
     *   https://<your-app>/index.html?caseId={CaseId}
     *
     * Configure this placeholder in the SC2 mashup URL template.
     */
    _getUrlParam(sName) {
      const url    = new URL(window.location.href);
      return url.searchParams.get(sName) || '';
    }

  });
});
