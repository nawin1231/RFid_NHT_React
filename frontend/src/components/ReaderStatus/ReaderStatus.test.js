import React from "react";
import { shallow } from "enzyme";
import ReaderStatus from "./ReaderStatus";

describe("ReaderStatus", () => {
  test("matches snapshot", () => {
    const wrapper = shallow(<ReaderStatus />);
    expect(wrapper).toMatchSnapshot();
  });
});
