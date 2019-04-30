import * as React from 'react';
import './style.css';

/* tslint:disable:no-console */
import { DropdownSelect } from '@tableau/tableau-ui';
import { MultipleSelector } from './MultipleSelector';

declare global {
  interface Window {
    tableau: any;
  }
}

let dashboard: any;
let parameter: any;

interface State {
  altMultiselect: boolean;
  bg: string;
  configured: boolean;
  currentVal: any[];
  disabled: boolean;
  firstInit: boolean;
  height: any;
  list: any;
  multiselect: boolean;
}

const NeedsConfiguring: string = 'Parameter needs configuration';

function fakeWhiteOverlay(hex: string) {
  const rgb = hexToRgb(hex);
  if (rgb) {
    return `rgb(${Math.min(Math.floor(rgb.r / 2) + 127, 255)}, ${Math.min(
      Math.floor(rgb.g / 2) + 127,
      255
    )}, ${Math.min(Math.floor(rgb.b / 2) + 127, 255)})`;
  } else {
    return '#ffffff';
  }
}

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        b: parseInt(result[3], 16),
        g: parseInt(result[2], 16),
        r: parseInt(result[1], 16),
      }
    : null;
}

class DataDrivenParameter extends React.Component<any, State> {
  public readonly state: State = {
    altMultiselect: false,
    bg: '#ffffff',
    configured: false,
    currentVal: [NeedsConfiguring],
    disabled: true,
    firstInit: true,
    height: 80,
    list: [NeedsConfiguring],
    multiselect: false,
  };

  // Pops open the configure page
  public configure = (): void => {
    const popupUrl = window.location.origin.includes('localhost')
      ? `${window.location.origin}/#/config`
      : `${window.location.origin}/data-driven-parameters-custom-ms/#/config`;
    const payload = '';
    window.tableau.extensions.ui
      .displayDialogAsync(popupUrl, payload, { height: 700, width: 450 })
      .then((closePayload: string) => {
        const settings = window.tableau.extensions.settings.getAll();
        if (closePayload !== '') {
          document.body.style.backgroundColor = settings.bg;
          document.body.style.color = settings.txt;
          this.setState({
            altMultiselect: settings.altMultiselect === 'true',
            bg: settings.bg ? fakeWhiteOverlay(settings.bg) : '#ffffff',
            height: settings.height || 80,
            multiselect: settings.multiselect === 'true',
          });
          this.findParameter();
        } else {
          this.setState({
            currentVal: [NeedsConfiguring],
            disabled: true,
            list: [NeedsConfiguring],
          });
        }
      })
      .catch((error: any) => {
        if (window.tableau.extensions.settings.get('configured') !== 'true') {
          this.setState({
            currentVal: [NeedsConfiguring],
            disabled: true,
            list: [NeedsConfiguring],
          });
        }
        switch (error.errorCode) {
          case window.tableau.ErrorCodes.DialogClosedByUser:
            console.log('Dialog was closed by user.');
            break;
          default:
            console.error(error.message);
        }
      });
  };

  // Locates the parameter to update
  public findParameter() {
    const settings = window.tableau.extensions.settings.getAll();
    window.tableau.extensions.dashboardContent.dashboard
      .findParameterAsync(settings.selParam)
      .then((param: any) => {
        parameter = param;
        if (!parameter || parameter.allowableValues.type !== 'all') {
          this.setState({
            currentVal: [NeedsConfiguring],
            disabled: true,
            list: [NeedsConfiguring],
          });
        } else {
          this.getParamData();
          this.setupWsEvent();
        }
      });
  }

  // Gets the values from the selected field and populates the Data-Driven Parameter
  public getParamData = (): void => {
    const settings = window.tableau.extensions.settings.getAll();
    const worksheet = dashboard.worksheets.find(
      (ws: any) => ws.name === settings.selWorksheet
    );
    if (!worksheet) {
      this.setState({
        currentVal: [NeedsConfiguring],
        disabled: true,
        list: [NeedsConfiguring],
      });
    } else {
      worksheet
        .getSummaryDataAsync({
          ignoreSelection: settings.ignoreSelection === 'true',
        })
        .then((dataTable: any) => {
          this.populateParam(dataTable);
        });
    }
  };

  // Pulls domain of selected field
  public populateParam(dataTable: any) {
    const settings = window.tableau.extensions.settings.getAll();
    const field = dataTable.columns.find(
      (column: any) => column.fieldName === settings.selField
    );
    if (!field) {
      this.setState({
        currentVal: [NeedsConfiguring],
        disabled: true,
        list: [NeedsConfiguring],
      });
    } else {
      let list = [];
      // Populate list with values from data source
      for (const row of dataTable.data) {
        list.push(
          settings.useFormattedValues === 'true'
            ? row[field.index].formattedValue
            : row[field.index].value
        );
      }

      // Remove duplicates
      list = list.filter((item, index, inputArray) => {
        return inputArray.indexOf(item) === index;
      });

      if (
        settings.dataType &&
        (settings.dataType === 'int' || settings.dataType === 'float')
      ) {
        list = list.map(Number);
        // Sort according to settings (numerical)
        if (settings.sort && settings.sort === 'desc') {
          list.sort((a, b) => b - a);
        } else {
          list.sort((a, b) => a - b);
        }
      } else {
        // Sort according to settings
        if (settings.sort && settings.sort === 'desc') {
          list.sort();
          list.reverse();
        } else {
          list.sort();
        }
      }

      // Add '(All)' according to settings
      if (
        settings.includeAllValue === 'true' &&
        settings.altMultiselect !== 'true'
      ) {
        list.unshift('(All)');
      }

      const newList = [];
      if (settings.altMultiselect === 'true') {
        for (let i = 0; i < list.length; i++) {
          newList.push({
            id: i,
            name: list[i],
          });
        }

        list = newList;

        this.setState({
          currentVal: [list],
          disabled: false,
          firstInit: false,
          height: settings.height,
          list,
        });
      } else {
        let currentVal;
        // Determine wether to use current param value or first value of list based on settings and if current Tableau parameter value is in list
        if (
          (settings.autoUpdate === 'false' ||
            (settings.autoUpdate === 'true' && !this.state.firstInit)) &&
          list.find(
            item => item.toString() === parameter.currentValue.value.toString()
          )
        ) {
          currentVal = parameter.currentValue.value;
        } else {
          currentVal = settings.includeAllValue === 'true' ? list[1] : list[0];
        }

        this.setState({
          currentVal: [currentVal],
          disabled: false,
          firstInit: false,
          list,
        });

        parameter.changeValueAsync(currentVal);
      }
    }
  }

  // Adds event listener to worksheet
  public setupWsEvent() {
    const settings = window.tableau.extensions.settings.getAll();
    const worksheet = dashboard.worksheets.find(
      (ws: any) => ws.name === settings.selWorksheet
    );
    if (!worksheet) {
      this.setState({
        currentVal: [NeedsConfiguring],
        disabled: true,
        list: [NeedsConfiguring],
      });
    } else {
      worksheet.addEventListener(
        window.tableau.TableauEventType.FilterChanged,
        this.getParamData
      );
      worksheet.addEventListener(
        window.tableau.TableauEventType.MarkSelectionChanged,
        this.getParamData
      );
    }
  }

  // Updates the parameter based on selection in Data-Driven Parameter
  public updateParam = (e: any) => {
    const settings = window.tableau.extensions.settings.getAll();
    const values = [];

    let newValue;
    if (settings.altMultiselect === 'true') {
      for (const opt of e) {
        if (!(opt in values)) {
          values.push(opt);
        }
      }

      newValue = values
        .map(v => {
          return v.name;
        })
        .join(settings.delimiter);
    } else {
      for (const opt of e.target.options) {
        if (opt.selected) {
          values.push(opt.value);
        }
      }

      newValue = values.join(settings.delimiter);
    }

    if (!parameter) {
      this.setState({
        currentVal: [NeedsConfiguring],
        disabled: true,
        list: [NeedsConfiguring],
      });
    } else {
      parameter.changeValueAsync(newValue);
      this.setState({ currentVal: values }, () => {
        console.log(this.state.currentVal);
      });
    }
    // Include to refresh domain on every selection:
    if (!this.state.multiselect && !this.state.altMultiselect) {
      this.getParamData();
    }
  };

  // Once we have mounted, we call to initialize
  public componentWillMount() {
    window.tableau.extensions
      .initializeAsync({ configure: this.configure })
      .then(() => {
        dashboard = window.tableau.extensions.dashboardContent.dashboard;
        const settings = window.tableau.extensions.settings.getAll();
        if (settings.configured === 'true') {
          document.body.style.backgroundColor = settings.bg;
          document.body.style.color = settings.txt;
          this.setState({
            altMultiselect: settings.altMultiselect === 'true',
            bg: settings.bg ? fakeWhiteOverlay(settings.bg) : '#ffffff',
            configured: true,
            multiselect: settings.multiselect === 'true',
          });
          this.findParameter();
        } else {
          this.configure();
        }
      });
  }

  public render() {
    return !this.state.altMultiselect ? (
      <React.Fragment>
        <div style={{ display: this.state.multiselect ? 'flex' : 'none' }}>
          <select
            multiple={true}
            id='multi-select-parameter'
            className='parameter'
            value={this.state.currentVal}
            onChange={this.updateParam}
            disabled={this.state.disabled}
            style={{ backgroundColor: this.state.bg, color: 'inherit' }}
          >
            {this.state.list.map((option: any) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: !this.state.multiselect ? 'flex' : 'none' }}>
          <DropdownSelect
            id='single-select-parameter'
            className='singleParameter'
            disabled={this.state.disabled || this.state.multiselect}
            kind='outline'
            onChange={this.updateParam}
            value={this.state.currentVal[0]}
            style={{ backgroundColor: this.state.bg, color: 'inherit' }}
          >
            {this.state.list.map((option: string) => (
              <option key={option}>{option}</option>
            ))}
          </DropdownSelect>
        </div>
      </React.Fragment>
    ) : (
      <React.Fragment>
        <MultipleSelector
          options={this.state.list}
          selected={this.state.currentVal}
          multiple={true}
          keepOpen={false}
          // tslint:disable-next-line:jsx-no-lambda
          onChange={this.updateParam}
          dropdownHeight={this.state.height + 'px'}
          // tslint:disable-next-line:jsx-no-lambda
          getFilterValue={e => {
            // tslint:disable-next-line:no-console
            console.log(e);
          }}
        />
      </React.Fragment>
    );
  }
}

export default DataDrivenParameter;
